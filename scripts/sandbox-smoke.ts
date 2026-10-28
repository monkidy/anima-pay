// Real check against the PayPal sandbox, with the credentials from .env. It proves what can be
// proved without a buyer clicking: a token is issued, an AUTHORIZE order is created, a repeated
// PayPal-Request-Id returns the same order instead of a second one, and PayPal reports the order
// as waiting for the payer. Nothing is approved, authorized or captured.
// Exit codes: 0 pass, 2 not configured, 1 failure.

import { loadConfig, redact } from "../src/config.ts";
import { PayPalSandbox, PayPalError } from "../src/paypal.ts";
import { idempotencyKey } from "../src/ledger.ts";

const config = loadConfig();
console.log("configuration:", redact(config));
if (!config.paypal) {
  console.log("NOT_CONFIGURED: set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET (sandbox app) in .env");
  process.exit(2);
}

const paypal = new PayPalSandbox(config.paypal);
const runId = new Date().toISOString();
const order = {
  requestId: `smoke-${idempotencyKey(["smoke", runId])}`,
  invoiceNumber: `SMOKE-${runId.slice(0, 19).replace(/[-:T]/g, "")}`,
  currency: "EUR",
  amountCents: 100,
  description: "ANIMA sandbox smoke test, never captured",
};

try {
  const first = await paypal.createOrder(order);
  const replay = await paypal.createOrder(order);
  const read = await paypal.getOrder(first.id);
  const checks = {
    order_created: typeof first.id === "string" && first.id.length > 0,
    intent_authorize: read.intent === "AUTHORIZE",
    replay_same_order: replay.id === first.id,
    waiting_for_payer: read.status === "CREATED" || read.status === "PAYER_ACTION_REQUIRED",
    approve_link: (first.links ?? []).some((l: any) => l.rel === "approve" || l.rel === "payer-action"),
  };
  console.log(JSON.stringify({ order_id: first.id, status: read.status, checks }, null, 2));
  const ok = Object.values(checks).every(Boolean);
  console.log(ok ? "SANDBOX_SMOKE_PASS" : "SANDBOX_SMOKE_FAIL");
  process.exit(ok ? 0 : 1);
} catch (e) {
  if (e instanceof PayPalError) console.error(`SANDBOX_SMOKE_FAIL: ${e.message} (HTTP ${e.status})`, JSON.stringify(e.details));
  else console.error("SANDBOX_SMOKE_FAIL:", (e as Error).message);
  process.exit(1);
}
