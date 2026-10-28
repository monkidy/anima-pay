// The four demo scenes, played end to end through the application, exactly as the screen does.

import { test } from "node:test";
import assert from "node:assert/strict";
import { AnimaApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";

function app() {
  return new AnimaApp(loadConfig({}, "missing.env"));
}

test("without credentials or model the app says it is simulated", () => {
  const m = app().mode();
  assert.equal(m.paypal, "simulated-sandbox");
  assert.equal(m.simulated, true);
  assert.match(m.advisor, /scripted/);
});

test("scene 1, a clean payment: proposed, approved by the payer, captured", async () => {
  const a = app();
  const run = await a.runScene(1);
  assert.equal(run.outcome, "awaiting_payer");
  a.approveAsPayer(run.pending_key!);
  const r = await a.release(run.pending_key!, "Studio Lumen");
  assert.equal(r.status, "COMPLETED");
  assert.equal(r.money_moved, true);
  assert.equal(r.evidence?.provider, "paypal-sandbox-simulator", "a simulated receipt must say it is simulated");
  assert.match(r.requested_action, /29\.00 EUR/);
  assert.match(r.advisor, /scripted/, "a scripted proposal must say it is scripted");
  assert.equal(a.state().pending.length, 0);
});

test("scene 2, the duplicate: held for a person, declined, nothing taken", async () => {
  const a = app();
  const run = await a.runScene(2);
  assert.equal(run.outcome, "awaiting_payer");
  const pending = a.state().pending[0];
  assert.deepEqual(pending.holds.sort(), ["MODEL_ADVISES_WAIT", "POSSIBLE_DUPLICATE"]);
  a.approveAsPayer(run.pending_key!);
  const blocked = await a.release(run.pending_key!);
  assert.equal(blocked.status, "BLOCKED");
  const declined = await a.decline(run.pending_key!, "Studio Lumen", "second copy of the October hosting bill");
  assert.equal(declined.receipt_type, "REFUSAL_RECEIPT");
  assert.equal(declined.money_moved, false);
  assert.equal(declined.evidence?.order_status, "APPROVED");
});

test("scene 3, the poisoned invoice: refused before any PayPal call", async () => {
  const a = app();
  const run = await a.runScene(3);
  assert.equal(run.outcome, "refused");
  assert.equal(run.advice.read.amount_cents, 99_900);
  assert.ok(run.receipt!.findings.some((f) => f.id === "PROPOSAL_DOES_NOT_MATCH_INVOICE"));
  assert.equal(run.receipt!.execution_started, false);
  assert.equal(run.receipt!.evidence, null);
});

test("scene 4, the golden seam: the correction sits next to the original, which is unchanged", async () => {
  const a = app();
  const run = await a.runScene(4);
  a.approveAsPayer(run.pending_key!);
  const paid = await a.release(run.pending_key!, "Studio Lumen");
  const sealed = a.goldenSeam(paid.receipt_id, "Studio Lumen");
  assert.equal(sealed.explanation, paid.explanation);
  assert.equal(sealed.corrections.length, 1);
  assert.equal(sealed.corrections[0].previous, paid.explanation);
  assert.match(sealed.corrections[0].replacement, /12\.00 to 14\.00/);
});

test("the French screen has a translation for every scripted sentence, scene and correction", async () => {
  const { SCENES, FR, GOLDEN_SEAM_CORRECTION } = await import("../src/scenes.ts");
  for (const s of SCENES) {
    assert.ok(FR.scenes[s.n]?.title && FR.scenes[s.n]?.teaches, `scene ${s.n} has no French text`);
    for (const si of [...s.seed, s.invoice]) for (const r of si.scripted.reasons) assert.ok(FR.reasons[r], `no French for: ${r}`);
  }
  assert.ok(FR.reasons[GOLDEN_SEAM_CORRECTION.replacement] && FR.reasons[GOLDEN_SEAM_CORRECTION.reason]);
  assert.ok(FR.mandate_purpose);
});

test("every receipt carries a code and a structured request, so a screen can translate it", async () => {
  const a = app();
  const refused = await a.runScene(3);
  assert.equal(refused.receipt!.explanation_code, "REFUSED_BY_GATE");
  assert.deepEqual(refused.receipt!.request, { amount_cents: 1_200, currency: "EUR", merchant: "invoices@cloud-backup.example", invoice_number: "CB-0077" });
  const run = await a.runScene(2);
  a.approveAsPayer(run.pending_key!);
  const declined = await a.decline(run.pending_key!, "Studio Lumen", "declined after review");
  assert.equal(declined.explanation_code, "DECLINED");
  assert.deepEqual(declined.explanation_params, { by: "Studio Lumen", reason: "declined after review" });
});

test("the four scenes in a row tell one consistent story in the ledger", async () => {
  const a = app();
  for (const n of [1, 2, 3, 4]) {
    const run = await a.runScene(n);
    if (run.outcome !== "awaiting_payer") continue;
    a.approveAsPayer(run.pending_key!);
    if (n === 2) await a.decline(run.pending_key!, "Studio Lumen", "duplicate");
    else await a.release(run.pending_key!, "Studio Lumen");
  }
  const receipts = a.state().receipts;
  assert.equal(receipts.filter((r) => r.money_moved).length, 2);
  assert.equal(receipts.filter((r) => !r.money_moved).length, 2);
  a.reset();
  assert.equal(a.state().receipts.length, 0);
});
