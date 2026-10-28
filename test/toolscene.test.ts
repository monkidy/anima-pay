// Scene 7 on the simulator: an agent works PayPal's own tools; reads pass, every write waits for a
// person, and what a person releases or declines is sealed in the same chain as the payments.

import { test } from "node:test";
import assert from "node:assert/strict";
import { AnimaApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";

test("scene 7: the agent reads freely, and the refund, the dispute and the cancellation all wait for a person", async () => {
  const a = new AnimaApp(loadConfig({}, "missing.env"));
  try {
    const before = await a.runToolScene();
    assert.ok(before.skipped.some((s) => s.includes("create_refund")));
    const pay = await a.runScene(1);
    a.approveAsPayer(pay.pending_key!);
    assert.equal((await a.release(pay.pending_key!, "Studio Lumen")).money_moved, true);
    const run = await a.runToolScene();
    assert.deepEqual(run.steps.map((s) => [s.call.tool, s.kind]), [
      ["get_order", "read"], ["create_refund", "held"], ["accept_dispute_claim", "held"], ["cancel_subscription", "held"],
    ]);
    const held = a.state().tool_pending;
    const refund = held.find((p) => p.call.tool === "create_refund")!;
    assert.deepEqual(refund.resolved, { amount_cents: 2_900, currency: "EUR" });
    const done = await a.toolRelease(refund.call.id, "Studio Lumen", refund.holds);
    assert.equal(done.status, "COMPLETED");
    for (const p of a.state().tool_pending) assert.equal(a.toolDecline(p.call.id, "Studio Lumen", "not asked for by the customer").status, "REFUSED");
    assert.equal(a.state().tool_pending.length, 0);
    assert.equal(a.verifyLedger().ok, true);
    // Two calls held by the first run (before any payment) plus three by the second: one released, four declined.
    assert.equal(a.state().tool_receipts.length, 5);
  } finally {
    a.close();
  }
});
