// Scene 7's rows and totals come from one view of each call's final outcome (Asso's reread of f0295d0,
// #3199/6373030882): a held call a person released must count where its row says it went.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { AnimaApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";

const ctx = createContext({});
runInContext(readFileSync(new URL("../web/firewall.js", import.meta.url), "utf8"), ctx);
const { firewallView, factsSource } = (ctx as any).animaFirewall;

const step = (id: string, kind: string, receipt_id?: string) => ({ call: { id, tool: id }, kind, receipt_id });
const receipt = (id: string, code: string, executed: boolean) => ({ receipt_id: `r-${id}`, call: { id }, explanation_code: code, executed });
const pending = (id: string) => ({ call: { id } });
const run = { steps: [step("read", "read", "r-read"), step("refund", "held"), step("dispute", "held")] };
const readReceipt = receipt("read", "TOOL_DONE", true);

test("before any decision: one read reached PayPal, two calls wait", () => {
  const v = firewallView(run, [readReceipt], [pending("refund"), pending("dispute")]);
  assert.deepEqual(Array.from(v.rows, (r: any) => r.kind), ["read", "held", "held"]);
  assert.deepEqual({ ...v.totals }, { sent: 1, held: 2, refused: 0, unclear: 0 });
});

test("a released call that ran counts as sent, the one still waiting stays held, nothing counts twice", () => {
  const v = firewallView(run, [readReceipt, receipt("refund", "TOOL_DONE", true)], [pending("dispute")]);
  assert.deepEqual(Array.from(v.rows, (r: any) => r.kind), ["read", "done", "held"]);
  // The released call's row found its receipt by call id: held steps carry no receipt id.
  assert.equal(v.rows[1].receipt.receipt_id, "r-refund");
  assert.deepEqual({ ...v.totals }, { sent: 2, held: 1, refused: 0, unclear: 0 });
  assert.equal(Object.values(v.totals).reduce((a: number, b: any) => a + b, 0), run.steps.length);
});

test("a release that did not acknowledge a hold leaves the call held; the later release that ran makes it sent", () => {
  const notAcked = { ...receipt("refund", "TOOL_RELEASE_NOT_ACKNOWLEDGED", false), receipt_id: "r-refund-1" };
  const waiting = firewallView(run, [readReceipt, notAcked], [pending("refund"), pending("dispute")]);
  assert.deepEqual(Array.from(waiting.rows, (r: any) => r.kind), ["read", "held", "held"]);
  // Whatever order the receipts come in: the API lists them newest first.
  for (const receipts of [[readReceipt, notAcked, receipt("refund", "TOOL_DONE", true)], [receipt("refund", "TOOL_DONE", true), notAcked, readReceipt]]) {
    const ran = firewallView(run, receipts, [pending("dispute")]);
    assert.deepEqual(Array.from(ran.rows, (r: any) => r.kind), ["read", "done", "held"]);
    assert.deepEqual({ ...ran.totals }, { sent: 2, held: 1, refused: 0, unclear: 0 });
  }
});

test("through the app's own state: a release refused for a missing acknowledgement, then one that went through", async () => {
  const app = new AnimaApp(loadConfig({}, "missing.env"));
  try {
    const paid = await app.runScene(1);
    app.approveAsPayer(paid.pending_key!);
    await app.release(paid.pending_key!, "Studio Lumen", []);
    const run = await app.runToolScene();
    const cancel = run.steps.find((s: any) => s.call.tool === "cancel_subscription")!;
    const kindOf = (v: any) => v.rows.find((r: any) => r.step.call.id === cancel.call.id).kind;

    const blocked = await app.toolRelease(cancel.call.id, "Studio Lumen", []);
    assert.equal(blocked.explanation_code, "TOOL_RELEASE_NOT_ACKNOWLEDGED");
    let s = app.state();
    assert.equal(kindOf(firewallView(run, s.tool_receipts, s.tool_pending)), "held");

    const decided = await app.toolRelease(cancel.call.id, "Studio Lumen", ["DESTRUCTIVE_ACTION"]);
    s = app.state();
    // The state lists receipts newest first: the deciding one comes before the refused release.
    const mine = s.tool_receipts.filter((r: any) => r.call.id === cancel.call.id).map((r: any) => r.explanation_code);
    assert.deepEqual(mine, [decided.explanation_code, "TOOL_RELEASE_NOT_ACKNOWLEDGED"]);
    const v = firewallView(run, s.tool_receipts, s.tool_pending);
    // The simulated PayPal does not know cancel_subscription: the call was sent, and PayPal refused it.
    assert.equal(kindOf(v), decided.explanation_code === "TOOL_DONE" ? "done" : "paypal_refused");
    assert.equal(v.totals.held, run.steps.filter((x: any) => x.kind === "held").length - 1);
    assert.equal(Object.values(v.totals).reduce((a: number, b: any) => a + b, 0), run.steps.length);
  } finally { app.close(); }
});

test("a declined call is refused; one PayPal refused was still sent; one PayPal never answered is unclear", () => {
  const declined = firewallView(run, [readReceipt, receipt("refund", "TOOL_DECLINED", false)], [pending("dispute")]);
  assert.deepEqual(Array.from(declined.rows, (r: any) => r.kind), ["read", "refused", "held"]);
  assert.deepEqual({ ...declined.totals }, { sent: 1, held: 1, refused: 1, unclear: 0 });
  const atPayPal = firewallView(run, [readReceipt, receipt("refund", "TOOL_FAILED_AT_PAYPAL", false), receipt("dispute", "TOOL_OUTCOME_UNKNOWN", false)], []);
  assert.deepEqual(Array.from(atPayPal.rows, (r: any) => r.kind), ["read", "paypal_refused", "unknown"]);
  assert.deepEqual({ ...atPayPal.totals }, { sent: 2, held: 0, refused: 0, unclear: 1 });
});

// Observed 29/10 on the hosted demo: PayPal's tool server answered every call, reads included, with
// PAYPAL_API_SETUP_ERROR, before sending anything to PayPal's payments API.
test("a call PayPal's tool server never sent is not shown as PayPal's refusal, nor a failed read as read", () => {
  const failedRead = { ...step("read", "read"), read: { ok: false, fields: [], error: "{\"ok\":false,\"code\":\"PAYPAL_API_SETUP_ERROR\"}" } };
  const v = firewallView({ steps: [failedRead, step("refund", "held")] }, [receipt("refund", "TOOL_NOT_SENT_BY_PAYPAL_TOOLS", true)], []);
  assert.deepEqual(Array.from(v.rows, (r: any) => r.kind), ["read_failed", "tools_failed"]);
  assert.deepEqual({ ...v.totals }, { sent: 2, held: 0, refused: 0, unclear: 0 });
});

// Provenance (Asso's real-Chrome QA of 0ebd175, #3199/6375953115): facts read by the simulator must never be
// credited to PayPal; only a real PayPal lookup is.
test("facts from the simulator are never credited to PayPal; a real lookup is", () => {
  const sim = { paypal: "simulated-sandbox" }, real = { paypal: "paypal-sandbox" };
  assert.equal(factsSource({ provider: "paypal-sandbox-mcp-simulator" }, sim), "simulated");
  assert.equal(factsSource({ provider: "paypal-sandbox-mcp-simulator" }, real), "simulated", "a simulator receipt stays simulated whatever the mode");
  assert.equal(factsSource({ provider: "paypal-sandbox-mcp" }, real), "paypal");
  assert.equal(factsSource({ call: { id: "waiting" } }, sim), "simulated", "a waiting call on a simulated desk");
  assert.equal(factsSource({ call: { id: "waiting" } }, real), "paypal");
  assert.equal(factsSource(null, sim), "simulated");
});

test("once a hosted demo's scene 7 left PayPal's failing tools, nothing new is credited to PayPal; an earlier hold still is", () => {
  const fellBack = { paypal: "paypal-sandbox", tools: "paypal-sandbox-mcp-simulator", tools_fallback: { tool: "get_order", code: "PAYPAL_API_SETUP_ERROR" } };
  assert.equal(factsSource(null, fellBack), "simulated", "a read the simulated tools answered");
  assert.equal(factsSource({ call: { id: "new" }, provider: "paypal-sandbox-mcp-simulator" }, fellBack), "simulated");
  assert.equal(factsSource({ call: { id: "held-before" }, provider: "paypal-sandbox-mcp" }, fellBack), "paypal", "held on PayPal's tools before the switch");
  assert.equal(factsSource({ call: { id: "read" }, kind: "read", provider: "paypal-sandbox-mcp" }, fellBack), "paypal", "a step PayPal's own tools answered, in a run that overlapped the switch");
  assert.equal(factsSource(null, { paypal: "paypal-sandbox", tools: "paypal-sandbox-mcp" }), "paypal");
});

test("through the app's own state on a simulated desk: every tool receipt and waiting call reads as simulated", async () => {
  const app = new AnimaApp(loadConfig({}, "missing.env"));
  try {
    const paid = await app.runScene(1);
    app.approveAsPayer(paid.pending_key!);
    await app.release(paid.pending_key!, "Studio Lumen", []);
    const run = await app.runToolScene();
    // A read seals no tool receipt; releasing the refund does, from the provider that answered.
    const refund = run.steps.find((x: any) => x.call.tool === "create_refund")!;
    await app.toolRelease(refund.call.id, "Studio Lumen", []);
    const s = app.state();
    assert.equal(s.mode.paypal, "simulated-sandbox");
    assert.ok(s.tool_receipts.length > 0, "a tool receipt was sealed");
    assert.ok(s.tool_pending.length > 0, "calls still wait for a person");
    assert.ok(s.tool_receipts.every((r: any) => r.provider === "paypal-sandbox-mcp-simulator"));
    for (const r of [...s.tool_receipts, ...s.tool_pending]) assert.equal(factsSource(r, s.mode), "simulated");
  } finally { app.close(); }
});

test("every source label has a simulated twin that says so, in English and in French", () => {
  const app = readFileSync(new URL("../web/app.js", import.meta.url), "utf8");
  const PROVENANCE = ["tool_read_from", "tool_read_ok", "tool_read_err", "tool_facts", "tool_result", "tool_ran", "fw_read", "fw_done",
    "fw_paypal_refused", "fw_unknown", "fw_sum_read", "fw_col_paypal", "step_paypal_refused", "step_unknown",
    "fw_read_failed", "fw_tools_failed", "step_tools_failed", "step_done"];
  for (const key of PROVENANCE) {
    const plain = [...app.matchAll(new RegExp(`(?<![A-Za-z_])${key}: "([^"]*)"`, "g"))].map((m) => m[1]);
    const sim = [...app.matchAll(new RegExp(`(?<![A-Za-z_])${key}_sim: "([^"]*)"`, "g"))].map((m) => m[1]);
    assert.equal(plain.length, 2, `${key} in English and in French`);
    assert.equal(sim.length, 2, `${key}_sim in English and in French`);
    for (const v of sim) assert.match(v, /simulated|simulé/i, `${key}_sim names the simulator: ${v}`);
  }
});

test("the screen never prints a source label without choosing its source first", () => {
  // A complement to the browser check: every provenance label goes through ts(key, source), so a simulated
  // desk cannot fall back to PayPal's wording by a direct t(key).
  const app = readFileSync(new URL("../web/app.js", import.meta.url), "utf8");
  const PROVENANCE = ["tool_read_from", "tool_read_ok", "tool_read_err", "tool_facts", "tool_result", "tool_ran", "fw_read", "fw_done",
    "fw_paypal_refused", "fw_unknown", "fw_sum_read", "fw_col_paypal", "fw_read_failed", "fw_tools_failed"];
  for (const key of PROVENANCE) assert.ok(!app.includes(`t("${key}"`), `${key} is printed without its source`);
  assert.ok(!app.includes("t(`step_${kind}`)"), "a step label is printed without its source");
  assert.ok(!app.includes("t(reached[kind])"), "a PayPal column label is printed without its source");
});
