// The tool firewall in front of PayPal's agent tools: unknown tools are refused, reads pass, and
// anything that moves money, reaches a customer or destroys a record meets the mandate and a person.

import { test } from "node:test";
import assert from "node:assert/strict";
import { TOOL_CLASSES, checkToolCall, classify, type ToolCall, type ToolMandate } from "../src/guard.ts";

const NOW = new Date("2026-11-03T10:00:00Z");
const MANDATE: ToolMandate = {
  id: "tm-1", owner: "Studio Lumen", purpose: "Run the shop's PayPal back office",
  allowed_classes: ["read", "money", "outreach", "destructive", "setup"],
  currency: "EUR", max_per_call_cents: 10_000, max_per_period_cents: 20_000, period_days: 30,
  human_release_above_cents: 3_000, recipients: ["client@shop.example"], expires_at: "2026-12-31T23:59:59Z", revoked: false,
};
const call = (tool: string, args: Record<string, unknown> = {}): ToolCall => ({ id: `c-${tool}`, tool, args, reason: "test", agent: "agent", requested_at: NOW.toISOString() });
const ids = (r: { findings: { id: string }[] }) => r.findings.map((f) => f.id);

test("every tool PayPal's sandbox server listed has a class, and an unknown tool is refused", () => {
  assert.equal(Object.keys(TOOL_CLASSES).length, 46);
  assert.equal(classify("create_refund"), "money");
  assert.equal(classify("toString"), null);
  const r = checkToolCall({ mandate: MANDATE, call: call("wire_everything_out"), resolved: {}, history: [], now: NOW });
  assert.equal(r.verdict, "fail");
  assert.deepEqual(ids(r), ["TOOL_NOT_CLASSIFIED"]);
});

test("a read passes without a person", () => {
  const r = checkToolCall({ mandate: MANDATE, call: call("get_order", { id: "X" }), resolved: {}, history: [], now: NOW });
  assert.equal(r.verdict, "pass");
  assert.equal(r.human_release_required, false);
});

test("a class the mandate does not allow is refused, even a read", () => {
  const r = checkToolCall({ mandate: { ...MANDATE, allowed_classes: ["setup"] }, call: call("list_transactions"), resolved: {}, history: [], now: NOW });
  assert.equal(r.verdict, "fail");
  assert.ok(ids(r).includes("TOOL_CLASS_NOT_IN_MANDATE"));
});

test("a refund whose amount PayPal could not tell is held for a person", () => {
  const r = checkToolCall({ mandate: MANDATE, call: call("create_refund", { capture_id: "C" }), resolved: {}, history: [], now: NOW });
  assert.equal(r.verdict, "hold");
  assert.equal(r.human_release_required, true);
  assert.ok(ids(r).includes("AMOUNT_UNKNOWN"));
});

test("a small refund passes; above the earned threshold a person must release; above the limit it is refused", () => {
  const small = checkToolCall({ mandate: MANDATE, call: call("create_refund"), resolved: { amount_cents: 2_900, currency: "EUR" }, history: [], now: NOW });
  assert.equal(small.verdict, "pass");
  assert.equal(small.human_release_required, false);
  const mid = checkToolCall({ mandate: MANDATE, call: call("create_refund"), resolved: { amount_cents: 5_000, currency: "EUR" }, history: [], now: NOW });
  assert.equal(mid.human_release_required, true);
  const big = checkToolCall({ mandate: MANDATE, call: call("create_refund"), resolved: { amount_cents: 15_000, currency: "EUR" }, history: [], now: NOW });
  assert.equal(big.verdict, "fail");
  assert.ok(ids(big).includes("OVER_PER_CALL_LIMIT"));
});

test("money moved in the period counts against the budget; outside the period it does not", () => {
  const recent = [{ tool: "create_refund", amount_cents: 9_000, currency: "EUR", at: "2026-10-30T10:00:00Z" }, { tool: "accept_dispute_claim", amount_cents: 9_000, currency: "EUR", at: "2026-11-01T10:00:00Z" }];
  const over = checkToolCall({ mandate: MANDATE, call: call("create_refund"), resolved: { amount_cents: 2_500, currency: "EUR" }, history: recent, now: NOW });
  assert.ok(ids(over).includes("OVER_PERIOD_BUDGET"));
  const old = recent.map((h) => ({ ...h, at: "2026-09-01T10:00:00Z" }));
  const fine = checkToolCall({ mandate: MANDATE, call: call("create_refund"), resolved: { amount_cents: 2_500, currency: "EUR" }, history: old, now: NOW });
  assert.equal(fine.verdict, "pass");
});

test("an invoice can only be sent to people the mandate names", () => {
  const ok = checkToolCall({ mandate: MANDATE, call: call("send_invoice"), resolved: { amount_cents: 1_000, currency: "EUR", recipients: ["CLIENT@shop.example"] }, history: [], now: NOW });
  assert.equal(ok.verdict, "pass");
  const stranger = checkToolCall({ mandate: MANDATE, call: call("send_invoice"), resolved: { amount_cents: 1_000, currency: "EUR", recipients: ["someone@else.example"] }, history: [], now: NOW });
  assert.equal(stranger.verdict, "fail");
  assert.ok(ids(stranger).includes("RECIPIENT_NOT_IN_MANDATE"));
  const unknown = checkToolCall({ mandate: MANDATE, call: call("send_invoice"), resolved: { amount_cents: 1_000, currency: "EUR" }, history: [], now: NOW });
  assert.ok(ids(unknown).includes("RECIPIENTS_UNKNOWN"));
});

test("deleting or cancelling always waits for a person", () => {
  const r = checkToolCall({ mandate: MANDATE, call: call("cancel_subscription", { subscription_id: "S" }), resolved: {}, history: [], now: NOW });
  assert.equal(r.verdict, "hold");
  assert.equal(r.human_release_required, true);
  assert.ok(ids(r).includes("DESTRUCTIVE_ACTION"));
});

test("a revoked or expired mandate stops everything but the refusal itself", () => {
  const revoked = checkToolCall({ mandate: { ...MANDATE, revoked: true }, call: call("get_order"), resolved: {}, history: [], now: NOW });
  assert.equal(revoked.verdict, "fail");
  const expired = checkToolCall({ mandate: { ...MANDATE, expires_at: "2026-11-01T00:00:00Z" }, call: call("create_invoice"), resolved: {}, history: [], now: NOW });
  assert.ok(ids(expired).includes("MANDATE_EXPIRED"));
});

test("a foreign currency is refused", () => {
  const r = checkToolCall({ mandate: MANDATE, call: call("create_refund"), resolved: { amount_cents: 1_000, currency: "USD" }, history: [], now: NOW });
  assert.ok(ids(r).includes("CURRENCY_NOT_IN_MANDATE"));
});
