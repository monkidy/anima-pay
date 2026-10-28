// The negative controls Asso's independent review asked for (#3199, comment 6364397553, 23/10/2026):
// a PENDING capture is never paid; the mandate is asked again at release time; the same for tool calls.
// (The fourth, a tampered ledger refused at load, lives in seal.test.ts.)

import { test } from "node:test";
import assert from "node:assert/strict";
import { PaymentDesk } from "../src/desk.ts";
import { Ledger } from "../src/ledger.ts";
import { PayPalSandbox, SANDBOX_BASE } from "../src/paypal.ts";
import { SandboxSimulator } from "../src/sim/sandbox-sim.ts";
import { McpSimulator } from "../src/sim/mcp-sim.ts";
import { McpSseClient } from "../src/mcp.ts";
import { ToolDesk } from "../src/tooldesk.ts";
import { AnimaApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import type { Invoice, Proposal, SpendMandate } from "../src/model.ts";
import type { ToolMandate } from "../src/guard.ts";

const SEAT = "billing@design-tool.example";
const realConfig = () => ({ ...loadConfig({}, "missing.env"), paypal: { clientId: "id", clientSecret: "secret", baseUrl: SANDBOX_BASE } });

test("a PENDING capture is not paid and earns no trust; once PayPal completes it, it is", async () => {
  const paypal = new SandboxSimulator();
  paypal.captureStatus = "PENDING";
  const a = new AnimaApp(realConfig(), { transport: paypal.transport });
  try {
    const run = await a.runScene(1);
    await a.standInTestPayer(run.pending_key!);
    const pending = await a.release(run.pending_key!, "Studio Lumen");
    assert.equal(pending.status, "PARTIAL");
    assert.equal(pending.money_moved, false);
    assert.equal(pending.evidence?.capture_status, "PENDING");
    assert.equal(a.trust(SEAT).streak, 0);
    assert.equal(a.state().receipts.filter((r) => r.money_moved).length, 0);
    // Asking again while PayPal still holds it changes nothing and seals nothing new.
    assert.equal((await a.release(run.pending_key!, "Studio Lumen")).receipt_id, pending.receipt_id);
    paypal.settle(pending.evidence!.capture_id!);
    const paid = await a.release(run.pending_key!, "Studio Lumen");
    assert.equal(paid.status, "COMPLETED");
    assert.equal(paid.money_moved, true);
    assert.equal(a.trust(SEAT).streak, 1);
    assert.equal(paypal.captureCount(), 1);
    assert.equal(a.state().pending.length, 0);
  } finally { a.close(); }
});

function mandate(over: Partial<SpendMandate> = {}): SpendMandate {
  return { id: "m", purpose: "p", currency: "EUR", max_per_payment_cents: 20_000, max_per_period_cents: 50_000, period_days: 30,
    merchants: [SEAT], human_release_above_cents: 5_000, expires_at: "2026-11-10T00:00:00Z", revoked: false, ...over };
}
const inv: Invoice = { id: "i1", number: "DT-1", merchant: SEAT, currency: "EUR", amount_cents: 2_900, issued_at: "2026-11-01", description: "seat" };
const prop: Proposal = { id: "p1", invoice_id: "i1", recommendation: "PAY", merchant: SEAT, currency: "EUR", amount_cents: 2_900, reasons: ["ok"], model: "t" };

test("a mandate that expires between the review and the release refuses the capture", async () => {
  let now = new Date("2026-11-05T10:00:00Z");
  const fake = new SandboxSimulator();
  const desk = new PaymentDesk({ paypal: new PayPalSandbox({ clientId: "id", clientSecret: "s", transport: fake.transport }), ledger: new Ledger(null), clock: () => now });
  const out = await desk.review(mandate(), inv, prop);
  assert.equal(out.kind, "awaiting_payer");
  if (out.kind !== "awaiting_payer") return;
  fake.approve(out.pending.order_id);
  now = new Date("2026-11-11T10:00:00Z");
  const r = await desk.release(out.pending.key);
  assert.equal(r.status, "NOT_AUTHORIZED");
  assert.equal(r.explanation_code, "MANDATE_CHANGED");
  assert.ok(r.findings.some((f) => f.id === "MANDATE_EXPIRED"));
  assert.equal(fake.captureCount(), 0);
});

test("a mandate revoked after the test card authorized: no capture, and the authorization is voided", async () => {
  let revoked = false;
  const fake = new SandboxSimulator();
  const paypal = new PayPalSandbox({ clientId: "id", clientSecret: "s", transport: fake.transport });
  const desk = new PaymentDesk({ paypal, ledger: new Ledger(null), clock: () => new Date("2026-11-05T10:00:00Z"), mandateNow: (m) => ({ ...m, revoked }) });
  const out = await desk.review(mandate(), inv, prop);
  if (out.kind !== "awaiting_payer") throw new Error("expected awaiting_payer");
  await desk.standInTestPayer(out.pending.key);
  revoked = true;
  const r = await desk.release(out.pending.key, { by: "Studio Lumen", at: "2026-11-05T10:01:00Z", acknowledged: [] });
  assert.equal(r.explanation_code, "MANDATE_CHANGED");
  assert.equal(r.evidence?.authorization_status, "VOIDED");
  assert.equal(fake.captureCount(), 0);
});

test("a held tool call whose mandate expired meanwhile is refused at release; PayPal is never asked", async () => {
  let now = new Date("2026-11-05T10:00:00Z");
  const mcp = new McpSimulator();
  const client = new McpSseClient({ token: async () => "t", fetcher: mcp.fetcher, timeoutMs: 2_000 });
  const tm: ToolMandate = { id: "tm", owner: "o", purpose: "p", allowed_classes: ["read", "money", "outreach", "destructive", "setup"], currency: "EUR",
    max_per_call_cents: 10_000, max_per_period_cents: 20_000, period_days: 30, human_release_above_cents: 0, recipients: [], expires_at: "2026-11-10T00:00:00Z", revoked: false };
  const desk = new ToolDesk({ tools: client, ledger: new Ledger(null), mandate: () => tm, resolver: async () => ({ amount_cents: 2_900, currency: "EUR" }), provider: "paypal-sandbox-mcp-simulator", clock: () => now });
  try {
    const out = await desk.request({ id: "c1", tool: "create_refund", args: { capture_id: "CAPTURE000000000001" }, reason: "r", agent: "a", requested_at: now.toISOString() });
    if (out.kind !== "held") throw new Error("expected a hold");
    now = new Date("2026-11-11T10:00:00Z");
    const r = await desk.release("c1", { by: "Studio Lumen", at: now.toISOString(), acknowledged: [] });
    assert.equal(r.status, "NOT_AUTHORIZED");
    assert.equal(r.explanation_code, "TOOL_MANDATE_CHANGED");
    assert.equal(mcp.count("create_refund"), 0);
  } finally { client.close(); }
});

test("a refund PayPal reports PENDING is partial, never money moved", async () => {
  const mcp = new McpSimulator();
  mcp.on("create_refund", (a) => ({ id: "REFUND-P", status: "PENDING", capture_id: a.capture_id }));
  const client = new McpSseClient({ token: async () => "t", fetcher: mcp.fetcher, timeoutMs: 2_000 });
  const tm: ToolMandate = { id: "tm", owner: "o", purpose: "p", allowed_classes: ["money"], currency: "EUR", max_per_call_cents: 10_000,
    max_per_period_cents: 20_000, period_days: 30, human_release_above_cents: 5_000, recipients: [], expires_at: "2026-12-31T00:00:00Z", revoked: false };
  const desk = new ToolDesk({ tools: client, ledger: new Ledger(null), mandate: () => tm, resolver: async () => ({ amount_cents: 2_900, currency: "EUR" }), provider: "paypal-sandbox-mcp-simulator" });
  try {
    const out = await desk.request({ id: "c2", tool: "create_refund", args: { capture_id: "CAPTURE000000000001" }, reason: "r", agent: "a", requested_at: new Date().toISOString() });
    assert.equal(out.kind, "done");
    if (out.kind === "done") {
      assert.equal(out.receipt.status, "PARTIAL");
      assert.equal(out.receipt.money_moved, false);
    }
  } finally { client.close(); }
});
