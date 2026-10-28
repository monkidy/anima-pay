// Earned trust: starts at zero, is proposed only after clean sealed payments, applies only once a
// person seals it, is lost at the first anomaly, and cannot be forged in the ledger.

import { test } from "node:test";
import assert from "node:assert/strict";
import { AnimaApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { steps } from "../src/trust.ts";
import { verifyChain } from "../src/seal.ts";
import { SANDBOX_BASE } from "../src/paypal.ts";
import { SandboxSimulator } from "../src/sim/sandbox-sim.ts";

const SEAT = "billing@design-tool.example";
const app = () => new AnimaApp(loadConfig({}, "missing.env"));

test("the ladder: 60 % of the mandate's release ceiling, then all of it", () => {
  assert.deepEqual(steps(5_000), [3_000, 5_000]);
});

test("a new merchant has no autonomy: even 29 EUR waits for a person", async () => {
  const a = app();
  assert.equal(a.trust(SEAT).granted_cents, 0);
  const run = await a.runScene(1);
  a.approveAsPayer(run.pending_key!);
  assert.equal((await a.release(run.pending_key!)).status, "BLOCKED");
});

test("three clean months let the agent propose a step; nothing changes until a person seals it", async () => {
  const a = app();
  await a.runScene(5);
  const t = a.trust(SEAT);
  assert.equal(t.streak, 3);
  assert.deepEqual(t.proposal?.to_cents, 3_000);
  assert.equal(t.granted_cents, 0, "a proposal is not a grant");
  const before = await a.runScene(6);
  a.approveAsPayer(before.pending_key!);
  assert.equal((await a.release(before.pending_key!)).status, "BLOCKED", "without a seal the agent still asks");
});

test("after the seal, the December seat is paid after the payer's approval without asking again", async () => {
  const a = app();
  await a.runScene(5);
  const granted = a.grantTrust(SEAT, "Studio Lumen");
  assert.equal(granted.granted_cents, 3_000);
  assert.equal(granted.proposal, null);
  const run = await a.runScene(6);
  a.approveAsPayer(run.pending_key!);
  const paid = await a.release(run.pending_key!);
  assert.equal(paid.status, "COMPLETED");
  assert.equal(paid.boundary.approval, "payer_on_paypal");
});

test("the first anomaly takes the margin back to zero", async () => {
  const a = app();
  await a.runScene(5);
  a.grantTrust(SEAT, "Studio Lumen");
  const replay = await a.runScene(1);
  assert.equal(replay.outcome, "awaiting_payer");
  a.approveAsPayer(replay.pending_key!);
  await a.release(replay.pending_key!, "Studio Lumen");
  const twin = await a.runScene(6);
  a.approveAsPayer(twin.pending_key!);
  await a.decline(twin.pending_key!, "Studio Lumen", "declined after review");
  const t = a.trust(SEAT);
  assert.equal(t.granted_cents, 0);
  assert.equal(t.last_anomaly?.reason, "DECLINED_BY_HUMAN");
  assert.deepEqual(t.curve.map((p) => p.why), ["grant", "reset"]);
});

test("no step can be granted without the record behind it", async () => {
  assert.throws(() => app().grantTrust(SEAT, "Studio Lumen"), /no step to grant/);
});

test("a grant is a sealed link of the chain: inflating it breaks verification", async () => {
  const a = app();
  await a.runScene(5);
  a.grantTrust(SEAT, "Studio Lumen");
  assert.equal(a.verifyLedger().ok, true);
  const { entries, publicKeyPem } = a.sealedLedger();
  const forged = JSON.parse(JSON.stringify(entries));
  const i = forged.findIndex((e: any) => e.schema === "anima.trust_grant.v0");
  forged[i].auto_release_cents = 1_000_000;
  assert.deepEqual(verifyChain(forged, publicKeyPem).broken, { index: i, reason: "HASH" });
});

test("on the real sandbox, the trust story waits for the payer on PayPal and resumes where it stopped", async () => {
  const paypal = new SandboxSimulator();
  const a = new AnimaApp({ ...loadConfig({}, "missing.env"), paypal: { clientId: "id", clientSecret: "secret", baseUrl: SANDBOX_BASE } }, { transport: paypal.transport });
  assert.equal(a.mode().paypal, "paypal-sandbox");
  const august = await a.runScene(5);
  assert.equal(august.outcome, "awaiting_payer");
  assert.equal(august.advice.read.invoice_number, "DT-2608");
  assert.throws(() => a.approveAsPayer(august.pending_key!), /approves on PayPal itself/);
  assert.equal(paypal.captureCount(), 0);
  const order = a.state().pending.find((p) => p.key === august.pending_key)!;
  paypal.approve(order.order_id);
  assert.equal((await a.release(august.pending_key!, "Studio Lumen")).money_moved, true);
  const september = await a.runScene(5);
  assert.equal(september.advice.read.invoice_number, "DT-2609");
  assert.equal(september.outcome, "awaiting_payer");
  assert.equal(paypal.captureCount(), 1);
});

test("the trust story says so when every month is already paid", async () => {
  const a = app();
  await a.runScene(5);
  await assert.rejects(() => a.runScene(5), /trust story is complete/);
});
