// The council: an unreadable voice counts as an objection, any objection to a PAY holds the
// payment for a person, every voice is kept in the receipt, and each voice is a separate real call.

import { test } from "node:test";
import assert from "node:assert/strict";
import { OpenAICompatibleAdvisor, type Fetcher } from "../src/advisor.ts";
import { ADVERSARY_PROMPT, VERIFIER_PROMPT, deliberate, parseOpinion, seat } from "../src/council.ts";
import { AnimaApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { checkPayment } from "../src/gate.ts";
import type { Advice } from "../src/advisor.ts";

const pay: Advice = { read: { invoice_number: "X-1", merchant: "billing@hosting.example", currency: "EUR", amount_cents: 1_000 }, recommendation: "PAY", reasons: ["Looks fine."] };

test("a voice that cannot be read is an objection, never a pass", () => {
  for (const bad of [null, "", "sure, pay it", "{oops}", '{"stance":"MAYBE","reasons":["x"]}', '{"stance":"OBJECT","reasons":[]}']) {
    assert.equal(parseOpinion(bad, "adversary").stance, "OBJECT", `input: ${bad}`);
  }
  assert.deepEqual(parseOpinion('{"stance":"NO_OBJECTION","reasons":["All consistent."]}', "verifier"), { stance: "NO_OBJECTION", reasons: ["All consistent."] });
});

test("one objection to a PAY holds the payment for a person", () => {
  const council = seat(pay, { stance: "OBJECT", reasons: ["Second copy of HB-1001."] }, { stance: "NO_OBJECTION", reasons: ["ok"] }, "m");
  assert.equal(council.dissent, true);
  const r = checkPayment({
    mandate: { id: "m", purpose: "", currency: "EUR", max_per_payment_cents: 50_000, max_per_period_cents: 100_000, period_days: 30, merchants: ["billing@hosting.example"], human_release_above_cents: 100_000, expires_at: "2027-01-01T00:00:00Z", revoked: false },
    invoice: { id: "i", number: "X-1", merchant: "billing@hosting.example", currency: "EUR", amount_cents: 1_000, issued_at: "2026-11-01", description: "" },
    proposal: { id: "p", invoice_id: "i", recommendation: "PAY", merchant: "billing@hosting.example", currency: "EUR", amount_cents: 1_000, reasons: [], model: "m", council },
    history: [], now: new Date("2026-11-02T00:00:00Z"),
  });
  assert.equal(r.verdict, "hold");
  assert.equal(r.human_release_required, true);
  assert.match(r.findings.find((f) => f.id === "COUNCIL_DISSENT")!.message, /Adversary: Second copy/);
});

test("the poisoned invoice: both objections and the dissent are written into the receipt", async () => {
  const a = new AnimaApp(loadConfig({}, "missing.env"));
  const run = await a.runScene(3);
  const d = run.receipt!.deliberation!;
  assert.equal(d.proposer.recommendation, "PAY");
  assert.equal(d.adversary.stance, "OBJECT");
  assert.equal(d.verifier.stance, "OBJECT");
  assert.equal(d.dissent, true);
  assert.ok(run.receipt!.findings.some((f) => f.id === "COUNCIL_DISSENT"));
  assert.equal(a.verifyLedger().ok, true, "the deliberation is inside the sealed receipt");
});

test("with a real provider, each voice is its own call with its own instructions", async () => {
  const seen: string[] = [];
  const fetcher: Fetcher = async (_url, init) => {
    const body = JSON.parse(init.body);
    seen.push(body.messages[0].content);
    const stance = body.messages[0].content === ADVERSARY_PROMPT ? "OBJECT" : "NO_OBJECTION";
    return { status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({ stance, reasons: [`${stance} by role`] }) } }] }) };
  };
  const model = new OpenAICompatibleAdvisor({ baseUrl: "http://m", model: "qwen", fetcher });
  const d = await deliberate(model, { invoiceText: "Invoice X-1, 10.00 EUR", recorded: pay.read, recentPayments: [] }, pay);
  assert.deepEqual(seen.sort(), [ADVERSARY_PROMPT, VERIFIER_PROMPT].sort());
  assert.equal(d.adversary.stance, "OBJECT");
  assert.equal(d.verifier.stance, "NO_OBJECTION");
  assert.equal(d.dissent, true);
});

test("an unreachable council objects twice", async () => {
  const down: Fetcher = async () => { throw new Error("ECONNREFUSED"); };
  const d = await deliberate(new OpenAICompatibleAdvisor({ baseUrl: "http://m", model: "qwen", fetcher: down }), { invoiceText: "", recorded: pay.read, recentPayments: [] }, pay);
  assert.equal(d.adversary.stance, "OBJECT");
  assert.equal(d.verifier.stance, "OBJECT");
});
