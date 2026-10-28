// What survives a restart: PayPal remembers every paid invoice, so a desk that forgot still cannot pay
// twice; and on the real sandbox the sealed ledger lives on disk, so the desk does not forget.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AnimaApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { SANDBOX_BASE } from "../src/paypal.ts";
import { SandboxSimulator } from "../src/sim/sandbox-sim.ts";

const realConfig = (ledgerPath = "unused.jsonl") => ({ ...loadConfig({}, "missing.env"), ledgerPath, paypal: { clientId: "id", clientSecret: "secret", baseUrl: SANDBOX_BASE } });

test("a desk that lost its ledger still cannot pay an invoice twice: PayPal refuses, and the refusal is sealed", async () => {
  const paypal = new SandboxSimulator();
  const first = new AnimaApp(realConfig(), { transport: paypal.transport });
  const run = await first.runScene(1);
  await first.standInTestPayer(run.pending_key!);
  assert.equal((await first.release(run.pending_key!, "Studio Lumen")).money_moved, true);
  first.close();
  // Long enough later that PayPal no longer replays the old request ids.
  paypal.forgetRequestIds();

  // The same PayPal account, a desk with an empty memory: the test-card path.
  const amnesic = new AnimaApp(realConfig(), { transport: paypal.transport });
  const again = await amnesic.runScene(1);
  const out = await amnesic.standInTestPayer(again.pending_key!);
  assert.ok("blocked" in out);
  if ("blocked" in out) {
    assert.equal(out.blocked.status, "BLOCKED");
    assert.equal(out.blocked.explanation_code, "ALREADY_PAID_AT_PAYPAL");
    assert.equal(out.blocked.money_moved, false);
  }
  assert.equal(amnesic.state().pending.length, 0);
  amnesic.close();

  // And the payer path: approved on PayPal, released, refused at authorization.
  const third = new AnimaApp(realConfig(), { transport: paypal.transport });
  const once = await third.runScene(1);
  paypal.approve(third.state().pending[0].order_id);
  const r = await third.release(once.pending_key!, "Studio Lumen");
  assert.equal(r.explanation_code, "ALREADY_PAID_AT_PAYPAL");
  assert.equal(paypal.captureCount(), 1);
  third.close();
});

test("on the real sandbox the sealed ledger survives a restart, and it cannot be reset", async () => {
  const dir = mkdtempSync(join(tmpdir(), "anima-ledger-"));
  const file = join(dir, "sub", "receipts.jsonl");
  const paypal = new SandboxSimulator();
  try {
    const before = new AnimaApp(realConfig(file), { transport: paypal.transport, persist: true });
    const run = await before.runScene(1);
    await before.standInTestPayer(run.pending_key!);
    const paid = await before.release(run.pending_key!, "Studio Lumen");
    const key = before.sealedLedger().publicKeyPem;
    before.close();

    const after = new AnimaApp(realConfig(file), { transport: paypal.transport, persist: true });
    assert.ok(after.state().receipts.some((r) => r.receipt_id === paid.receipt_id));
    assert.equal(after.verifyLedger().ok, true);
    assert.equal(after.sealedLedger().publicKeyPem, key);
    assert.throws(() => after.reset(), /refusing to reset a persistent ledger/);
    after.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("any definitive refusal from PayPal is a sealed receipt, never a raw error; a lost answer is not a refusal", async () => {
  const paypal = new SandboxSimulator();
  const refusing = async (req: any) => req.url.endsWith("/v2/checkout/orders") && req.body?.includes('"card"')
    ? { status: 422, json: { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "TRANSACTION_REFUSED" }] } }
    : paypal.transport(req);
  const a = new AnimaApp(realConfig(), { transport: refusing });
  const run = await a.runScene(1);
  const out = await a.standInTestPayer(run.pending_key!);
  assert.ok("blocked" in out && out.blocked.explanation_code === "REFUSED_BY_PAYPAL");
  a.close();

  const flaky = async (req: any) => req.url.endsWith("/v2/checkout/orders") && req.body?.includes('"card"')
    ? { status: 503, json: { name: "SERVICE_UNAVAILABLE" } }
    : paypal.transport(req);
  const b = new AnimaApp(realConfig(), { transport: flaky });
  const run2 = await b.runScene(1);
  await assert.rejects(() => b.standInTestPayer(run2.pending_key!), /HTTP 503/);
  b.close();
});

test("a card order PayPal answers without a fresh authorization is sealed: captured means paid, anything else refused", async () => {
  const paypal = new SandboxSimulator();
  const answer = (authStatus: string) => async (req: any) => req.url.endsWith("/v2/checkout/orders") && req.body?.includes('"card"')
    ? { status: 201, json: { id: "ORDERX", status: "COMPLETED", purchase_units: [{ payments: { authorizations: [{ id: "AUTHX", status: authStatus }] } }] } }
    : paypal.transport(req);
  const a = new AnimaApp(realConfig(), { transport: answer("CAPTURED") });
  const out = await a.standInTestPayer((await a.runScene(1)).pending_key!);
  assert.ok("blocked" in out && out.blocked.explanation_code === "ALREADY_PAID_AT_PAYPAL");
  a.close();
  const b = new AnimaApp(realConfig(), { transport: answer("DENIED") });
  const out2 = await b.standInTestPayer((await b.runScene(1)).pending_key!);
  assert.ok("blocked" in out2 && out2.blocked.explanation_code === "REFUSED_BY_PAYPAL");
  if ("blocked" in out2) assert.equal(out2.blocked.explanation_params.issue, "AUTHORIZATION_DENIED");
  b.close();
});

test("visitors of a hosted demo share one PayPal account without colliding with each other or with earlier runs", async () => {
  // The account already paid this invoice from the founder's own desk, and PayPal still replays those requests.
  const paypal = new SandboxSimulator();
  const local = new AnimaApp(realConfig(), { transport: paypal.transport });
  const first = await local.runScene(1);
  await local.standInTestPayer(first.pending_key!);
  const founders = await local.release(first.pending_key!, "Studio Lumen");
  assert.equal(founders.money_moved, true);
  local.close();

  // Two hosted visitors, each with a desk of its own on that same account: both pay, PayPal sees two invoice ids.
  for (const visitor of ["visitor A", "visitor B"]) {
    const hosted = new AnimaApp(realConfig(), { transport: paypal.transport, sharedPayPal: true });
    const run = await hosted.runScene(1);
    const card = await hosted.standInTestPayer(run.pending_key!);
    assert.ok(!("blocked" in card), `${visitor}: ${"blocked" in card ? card.blocked.explanation : ""}`);
    const receipt = await hosted.release(run.pending_key!, visitor);
    assert.equal(receipt.money_moved, true, visitor);
    assert.notEqual(receipt.evidence?.capture_id, founders.evidence?.capture_id, `${visitor} paid with a capture of its own`);
    assert.equal(receipt.request.invoice_number, "DT-2611", "the visitor still sees the invoice's own number");
    hosted.close();
  }
  const paid = [...(paypal as any).paidInvoices] as string[];
  assert.equal(paid.length, 3);
  assert.equal(paid.filter((id) => id === "DT-2611").length, 1, "only the founder's desk used the bare number");

  // What the scope prevents: a desk without ids of its own sends the founder's request ids again, and
  // PayPal replays the founder's answers, down to the capture; that desk would seal a receipt for money it
  // never moved.
  const unscoped = new AnimaApp(realConfig(), { transport: paypal.transport });
  const again = await unscoped.runScene(1);
  await unscoped.standInTestPayer(again.pending_key!);
  const replayed = await unscoped.release(again.pending_key!, "visitor C");
  assert.equal(replayed.evidence?.capture_id, founders.evidence?.capture_id);
  unscoped.close();
});
