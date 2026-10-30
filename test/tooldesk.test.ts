// The tool desk in front of PayPal's agent tools: facts read from PayPal, holds for a person, and a
// sealed receipt for every outcome, including the calls that never ran.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Ledger } from "../src/ledger.ts";
import { McpSseClient } from "../src/mcp.ts";
import { McpSimulator } from "../src/sim/mcp-sim.ts";
import { SandboxSimulator } from "../src/sim/sandbox-sim.ts";
import { PayPalSandbox } from "../src/paypal.ts";
import { ToolDesk, moneyOf, paypalFacts } from "../src/tooldesk.ts";
import type { ToolCall, ToolMandate } from "../src/guard.ts";
import { verifyChain } from "../src/seal.ts";

const NOW = new Date("2026-11-03T10:00:00Z");
const MANDATE: ToolMandate = {
  id: "tm-1", owner: "Studio Lumen", purpose: "Run the shop's PayPal back office",
  allowed_classes: ["read", "money", "outreach", "destructive", "setup"],
  currency: "EUR", max_per_call_cents: 10_000, max_per_period_cents: 20_000, period_days: 30,
  human_release_above_cents: 0, recipients: ["client@shop.example"], expires_at: "2026-12-31T23:59:59Z", revoked: false,
};
let n = 0;
const call = (tool: string, args: Record<string, unknown> = {}): ToolCall => ({ id: `call-${++n}`, tool, args, reason: "test", agent: "test-agent", requested_at: NOW.toISOString() });
const release = (acknowledged: string[] = []) => ({ by: "Studio Lumen", at: NOW.toISOString(), acknowledged });

async function setup(mandate: ToolMandate = MANDATE, provider: "paypal-sandbox-mcp" | "paypal-sandbox-mcp-simulator" = "paypal-sandbox-mcp-simulator") {
  const mcp = new McpSimulator();
  const rest = new SandboxSimulator();
  const paypal = new PayPalSandbox({ clientId: "id", clientSecret: "secret", transport: rest.transport, simulated: true });
  // A real-looking captured payment to refund: an order paid by the sandbox test card, then captured.
  const order = await paypal.createOrder({ requestId: "o1", invoiceNumber: "DT-2611", currency: "EUR", amountCents: 2_900, description: "seat", testCard: true });
  const capture = await paypal.captureAuthorization(order.purchase_units[0].payments.authorizations[0].id, "c1");
  const client = new McpSseClient({ token: async () => "t", fetcher: mcp.fetcher, timeoutMs: 2_000 });
  const ledger = new Ledger(null);
  const desk = new ToolDesk({ tools: client, ledger, mandate: () => mandate, resolver: paypalFacts({ capture: (id) => paypal.getCapture(id) }), provider, clock: () => NOW });
  return { mcp, client, ledger, desk, captureId: capture.id as string };
}

test("money in PayPal's format becomes cents without floating-point drift", () => {
  assert.deepEqual(moneyOf({ currency_code: "eur", value: "29.00" }), { amount_cents: 2_900, currency: "EUR" });
  assert.deepEqual(moneyOf({ currency_code: "EUR", value: "0.1" }), { amount_cents: 10, currency: "EUR" });
  assert.equal(moneyOf({ currency_code: "EUR", value: "1e3" }), undefined);
});

test("a read goes to PayPal and back, and leaves no receipt", async () => {
  const { desk, ledger, client } = await setup();
  try {
    const out = await desk.request(call("get_order", { id: "ORDER1" }));
    assert.equal(out.kind, "read");
    assert.equal(ledger.toolReceipts().length, 0);
  } finally { client.close(); }
});

test("a refund is held, its amount read from the capture at PayPal, and runs only after a person's release", async () => {
  const { desk, ledger, mcp, client, captureId } = await setup();
  try {
    const out = await desk.request(call("create_refund", { capture_id: captureId }));
    assert.equal(out.kind, "held");
    if (out.kind !== "held") return;
    assert.deepEqual(out.pending.resolved, { amount_cents: 2_900, currency: "EUR" });
    assert.equal(mcp.count("create_refund"), 0);
    const r = await desk.release(out.pending.call.id, release());
    assert.equal(r.status, "COMPLETED");
    assert.equal(r.money_moved, true);
    assert.equal(r.release?.by, "Studio Lumen");
    assert.equal(mcp.count("create_refund"), 1);
    assert.equal(ledger.verify().ok, true);
    assert.equal(verifyChain(ledger.sealedEntries(), ledger.publicKeyPem).ok, true);
    await assert.rejects(() => desk.release(out.pending.call.id, release()), /no held tool call/);
  } finally { client.close(); }
});

test("a second refund on the same capture is held as a repeat, and needs its own acknowledgment", async () => {
  const { desk, client, captureId } = await setup({ ...MANDATE, human_release_above_cents: 5_000 });
  try {
    const first = await desk.request(call("create_refund", { capture_id: captureId, amount: { currency_code: "EUR", value: "10.00" } }));
    assert.equal(first.kind, "done");
    const second = await desk.request(call("create_refund", { capture_id: captureId, amount: { currency_code: "EUR", value: "10.00" } }));
    assert.equal(second.kind, "held");
    if (second.kind !== "held") return;
    assert.ok(second.pending.gate.findings.some((f) => f.id === "REPEATED_CALL"));
    const blocked = await desk.release(second.pending.call.id, release());
    assert.equal(blocked.status, "BLOCKED");
    assert.equal((await desk.release(second.pending.call.id, release(["REPEATED_CALL"]))).status, "COMPLETED");
  } finally { client.close(); }
});

test("an unknown tool is refused and sealed; PayPal is never asked", async () => {
  const { desk, mcp, ledger, client } = await setup();
  try {
    const out = await desk.request(call("transfer_all_funds", { to: "attacker@evil.example" }));
    assert.equal(out.kind, "refused");
    assert.equal(mcp.calls.length, 0);
    assert.equal(ledger.toolReceipts()[0].findings[0].id, "TOOL_NOT_CLASSIFIED");
  } finally { client.close(); }
});

test("an invoice to someone the mandate does not name is refused, the recipients read from PayPal", async () => {
  const { desk, mcp, client } = await setup({ ...MANDATE, recipients: ["other@shop.example"] });
  try {
    const out = await desk.request(call("send_invoice", { invoice_id: "INV-1" }));
    assert.equal(out.kind, "refused");
    assert.equal(mcp.count("send_invoice"), 0);
    if (out.kind === "refused") assert.deepEqual(out.receipt.resolved.recipients, ["client@shop.example"]);
  } finally { client.close(); }
});

test("a decline seals a refusal and PayPal is never asked", async () => {
  const { desk, mcp, client, captureId } = await setup();
  try {
    const out = await desk.request(call("create_refund", { capture_id: captureId }));
    if (out.kind !== "held") throw new Error("expected a hold");
    const r = desk.decline(out.pending.call.id, "Studio Lumen", "the customer withdrew the request");
    assert.equal(r.status, "REFUSED");
    assert.equal(mcp.count("create_refund"), 0);
  } finally { client.close(); }
});

test("when PayPal refuses, the receipt says so and no money is marked as moved", async () => {
  const { desk, mcp, client, captureId } = await setup({ ...MANDATE, human_release_above_cents: 5_000 });
  mcp.on("create_refund", () => { throw new Error("unused"); });
  try {
    // A handler that throws makes the stand-in answer with an error result, as PayPal does.
    const out = await desk.request(call("create_refund", { capture_id: captureId }));
    assert.equal(out.kind, "done");
    if (out.kind === "done") {
      assert.equal(out.receipt.status, "FAILED");
      assert.equal(out.receipt.money_moved, false);
    }
  } finally { client.close(); }
});

test("when PayPal does not answer, the outcome is recorded as unknown, never as not run", async () => {
  const { ledger, captureId } = await setup();
  const silent = { listTools: async () => [], callTool: async () => { throw new Error("socket hang up"); }, close() {} };
  const desk = new ToolDesk({ tools: silent, ledger, mandate: () => ({ ...MANDATE, human_release_above_cents: 5_000 }), resolver: async () => ({ amount_cents: 2_900, currency: "EUR" }), provider: "paypal-sandbox-mcp-simulator", clock: () => NOW });
  const out = await desk.request(call("create_refund", { capture_id: captureId }));
  assert.equal(out.kind, "done");
  if (out.kind === "done") {
    assert.equal(out.receipt.status, "PARTIAL");
    assert.ok(out.receipt.findings.some((f) => f.id === "OUTCOME_UNKNOWN"));
  }
});

test("a refund PayPal answers with {ok:false} is a failure, not money moved, even without the error flag", async () => {
  const { desk, mcp, client, captureId } = await setup({ ...MANDATE, human_release_above_cents: 5_000 });
  mcp.on("create_refund", () => ({ ok: false, status: 403, code: "PAYPAL_API_HTTP_ERROR", message: "Authorization failed due to insufficient permissions." }));
  try {
    const out = await desk.request(call("create_refund", { capture_id: captureId }));
    assert.equal(out.kind, "done");
    if (out.kind === "done") {
      assert.equal(out.receipt.status, "FAILED");
      assert.equal(out.receipt.money_moved, false);
      assert.equal(out.receipt.result?.is_error, true);
    }
  } finally { client.close(); }
});

// Observed 29/10 on the hosted demo (scene 7, receipt #4), then the same evening for every tool, reads
// included, while PayPal's REST API answered the same token: PayPal's tool server answered this.
const SETUP_ERROR = { ok: false, code: "PAYPAL_API_SETUP_ERROR", message: "Unsupported cache mode: default" };

test("a released refund PayPal's tool server never sent is sealed as a connection fault, never as PayPal's refusal", async () => {
  const { desk, ledger, mcp, client, captureId } = await setup();
  mcp.on("create_refund", () => SETUP_ERROR);
  try {
    const out = await desk.request(call("create_refund", { capture_id: captureId }));
    if (out.kind !== "held") throw new Error("expected a hold");
    const r = await desk.release(out.pending.call.id, release());
    assert.equal(r.explanation_code, "TOOL_NOT_SENT_BY_PAYPAL_TOOLS");
    assert.deepEqual(r.explanation_params, { tool: "create_refund", code: "PAYPAL_API_SETUP_ERROR", message: "Unsupported cache mode: default" });
    assert.doesNotMatch(r.explanation, /PayPal refused/);
    assert.ok(r.findings.some((f) => f.id === "PAYPAL_TOOLS_NOT_SENT") && !r.findings.some((f) => f.id === "PAYPAL_REFUSED"));
    // The sealing rules do not move: the outcome is sealed in the chain, failed, and no money counts as moved.
    assert.equal(r.receipt_type, "BLOCKED_ACTION_RECEIPT");
    assert.equal(r.status, "FAILED");
    assert.equal(r.money_moved, false);
    assert.equal(r.result?.is_error, true);
    assert.equal(mcp.count("create_refund"), 1);
    assert.equal(ledger.toolReceipts().at(-1)?.receipt_id, r.receipt_id);
    assert.equal(verifyChain(ledger.sealedEntries(), ledger.publicKeyPem).ok, true);
  } finally { client.close(); }
});

test("PayPal's own refusal, with its HTTP status, still says PayPal refused", async () => {
  const { desk, mcp, client, captureId } = await setup({ ...MANDATE, human_release_above_cents: 5_000 });
  mcp.on("create_refund", () => ({ ok: false, status: 422, code: "PAYPAL_API_HTTP_ERROR", message: "The capture has already been fully refunded" }));
  try {
    const out = await desk.request(call("create_refund", { capture_id: captureId }));
    if (out.kind !== "done") throw new Error("expected a run");
    assert.equal(out.receipt.explanation_code, "TOOL_FAILED_AT_PAYPAL");
    assert.match(out.receipt.explanation, /PayPal refused create_refund/);
    assert.equal(out.receipt.money_moved, false);
  } finally { client.close(); }
});

test("a call PayPal's tools sent without getting an answer is unknown, not failed: it may have run", async () => {
  const { desk, mcp, client, captureId } = await setup({ ...MANDATE, human_release_above_cents: 5_000 });
  mcp.on("create_refund", () => ({ ok: false, code: "PAYPAL_API_NO_RESPONSE", message: "timeout of 30000ms exceeded" }));
  try {
    const out = await desk.request(call("create_refund", { capture_id: captureId }));
    if (out.kind !== "done") throw new Error("expected a run");
    assert.equal(out.receipt.receipt_type, "PARTIAL_ACTION_RECEIPT");
    assert.equal(out.receipt.status, "PARTIAL");
    assert.equal(out.receipt.explanation_code, "TOOL_OUTCOME_UNKNOWN");
    assert.ok(out.receipt.findings.some((f) => f.id === "OUTCOME_UNKNOWN"));
    assert.equal(out.receipt.money_moved, false);
  } finally { client.close(); }
});

test("what the simulated PayPal ran or refused is never credited to PayPal; what PayPal's own tools ran is", async () => {
  const mandate = { ...MANDATE, human_release_above_cents: 5_000 };
  const sim = await setup(mandate);
  const failing = await setup(mandate);
  const real = await setup(mandate, "paypal-sandbox-mcp");
  try {
    const ran = await sim.desk.request(call("create_refund", { capture_id: sim.captureId }));
    if (ran.kind !== "done") throw new Error("expected a run");
    assert.match(ran.receipt.explanation, /and the simulated PayPal ran it\.$/);
    failing.mcp.on("create_refund", () => { throw new Error("no such capture"); });
    const refused = await failing.desk.request(call("create_refund", { capture_id: failing.captureId }));
    if (refused.kind !== "done") throw new Error("expected a run");
    assert.equal(refused.receipt.explanation_code, "TOOL_FAILED_AT_PAYPAL");
    assert.equal(refused.receipt.explanation, "Not done. The simulated PayPal refused create_refund.");
    assert.deepEqual(refused.receipt.findings.find((f) => f.id === "PAYPAL_REFUSED")?.params, { source: "simulated" });
    const live = await real.desk.request(call("create_refund", { capture_id: real.captureId }));
    if (live.kind !== "done") throw new Error("expected a run");
    assert.match(live.receipt.explanation, /, and PayPal ran it\.$/);
  } finally { sim.client.close(); failing.client.close(); real.client.close(); }
});
