// The PayPal client's own promises: what it sends to PayPal, and what the desk can learn back from
// PayPal itself while a payment waits for the payer.

import { test } from "node:test";
import assert from "node:assert/strict";
import { AnimaApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { PayPalSandbox, SANDBOX_BASE, isReservedExample, type HttpRequest } from "../src/paypal.ts";
import { SandboxSimulator } from "../src/sim/sandbox-sim.ts";

function recording(): { paypal: PayPalSandbox; sent: () => any[]; ids: () => string[] } {
  const sim = new SandboxSimulator();
  const orders: HttpRequest[] = [];
  const paypal = new PayPalSandbox({ clientId: "id", clientSecret: "secret", transport: async (req) => {
    if (req.url.endsWith("/v2/checkout/orders")) orders.push(req);
    return sim.transport(req);
  } });
  return { paypal, sent: () => orders.map((r) => JSON.parse(r.body!)), ids: () => orders.map((r) => r.headers["PayPal-Request-Id"]) };
}

const order = { requestId: "order-k", invoiceNumber: "DT-2611", currency: "EUR", amountCents: 2_900, description: "Design tool, November seat" };

test("a reserved example address is never sent as payee: the sandbox app's own merchant stands in", async () => {
  assert.equal(isReservedExample("billing@design-tool.example"), true);
  assert.equal(isReservedExample("billing@design-tool.com"), false);
  const r = recording();
  await r.paypal.createOrder({ ...order, payee: "billing@design-tool.example" });
  await r.paypal.createOrder({ ...order, payee: "billing@design-tool.com" });
  assert.equal(r.sent()[0].purchase_units[0].payee, undefined);
  assert.deepEqual(r.sent()[1].purchase_units[0].payee, { email_address: "billing@design-tool.com" });
});

test("with a return address, PayPal is told where to send the payer back", async () => {
  const r = recording();
  await r.paypal.createOrder({ ...order, returnUrl: "http://127.0.0.1:5275/?paypal=return", cancelUrl: "http://127.0.0.1:5275/?paypal=cancel" });
  const ctx = r.sent()[0].payment_source.paypal.experience_context;
  assert.equal(ctx.return_url, "http://127.0.0.1:5275/?paypal=return");
  assert.equal(ctx.cancel_url, "http://127.0.0.1:5275/?paypal=cancel");
});

test("the same request replays the same order; a changed request is a new request", async () => {
  const r = recording();
  const a = await r.paypal.createOrder(order);
  const b = await r.paypal.createOrder(order);
  const c = await r.paypal.createOrder({ ...order, returnUrl: "http://127.0.0.1:5275/" });
  assert.equal(a.id, b.id);
  assert.notEqual(a.id, c.id);
  assert.equal(r.ids()[0], r.ids()[1]);
  assert.notEqual(r.ids()[0], r.ids()[2]);
  assert.match(r.ids()[0], /^order-k-[0-9a-f]{8}$/);
});

test("the desk asks PayPal itself whether the payer approved, and the receipt names PayPal's payee", async () => {
  const sim = new SandboxSimulator();
  const a = new AnimaApp({ ...loadConfig({}, "missing.env"), paypal: { clientId: "id", clientSecret: "secret", baseUrl: SANDBOX_BASE } },
    { transport: sim.transport, returnUrl: "http://127.0.0.1:5275/" });
  const run = await a.runScene(1);
  const before = await a.payerStatus(run.pending_key!);
  assert.equal(before.payer_approved, false);
  assert.equal(before.status, "PAYER_ACTION_REQUIRED");
  sim.approve(before.order_id);
  assert.equal((await a.payerStatus(run.pending_key!)).payer_approved, true);
  const receipt = await a.release(run.pending_key!, "Studio Lumen");
  assert.equal(receipt.money_moved, true);
  assert.equal(receipt.evidence?.payee_at_paypal, "merchant@business.example.com");
});

test("with the sandbox test card, PayPal is sent the card and no payer redirect", async () => {
  const r = recording();
  const o = await r.paypal.createOrder({ ...order, testCard: true, returnUrl: "http://127.0.0.1:5275/" });
  assert.equal(r.sent()[0].payment_source.card.number, "4012888888881881");
  assert.equal(r.sent()[0].payment_source.paypal, undefined);
  assert.equal(o.status, "COMPLETED");
});

function realSandboxApp() {
  const sim = new SandboxSimulator();
  const a = new AnimaApp({ ...loadConfig({}, "missing.env"), paypal: { clientId: "id", clientSecret: "secret", baseUrl: SANDBOX_BASE } },
    { transport: sim.transport, returnUrl: "http://127.0.0.1:5275/" });
  return { a, sim };
}

test("the test card stands in for the payer only: a person's release is still required", async () => {
  const { a, sim } = realSandboxApp();
  const run = await a.runScene(1);
  await a.standInTestPayer(run.pending_key!);
  assert.equal((await a.payerStatus(run.pending_key!)).stand_in, "sandbox_test_card");
  const blocked = await a.release(run.pending_key!);
  assert.equal(blocked.money_moved, false);
  assert.equal(sim.captureCount(), 0);
  await assert.rejects(() => a.standInTestPayer(run.pending_key!), /already holds/);
  const paid = await a.release(run.pending_key!, "Studio Lumen");
  assert.equal(paid.money_moved, true);
  assert.equal(paid.boundary.approval, "sandbox_test_card_and_human_release");
  assert.equal(paid.explanation_code, "PAID_TEST_PAYER");
  assert.equal(paid.evidence?.payer_source, "card VISA 1881");
  assert.equal(sim.captureCount(), 1);
});

test("declining after the test card voids PayPal's authorization: nothing is taken", async () => {
  const { a, sim } = realSandboxApp();
  const run = await a.runScene(1);
  await a.standInTestPayer(run.pending_key!);
  const declined = await a.decline(run.pending_key!, "Studio Lumen", "changed my mind");
  assert.equal(declined.money_moved, false);
  assert.equal(declined.evidence?.authorization_status, "VOIDED");
  assert.equal(sim.captureCount(), 0);
});
