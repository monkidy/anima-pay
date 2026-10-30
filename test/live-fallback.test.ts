// The hosted demo's safety net: when the live model cannot answer (provider failing or unreachable,
// daily budget spent), the scene script answers instead and the run's label says so. When the model
// does answer, even badly, its answer stands: a malformed answer stays the fail-safe WAIT.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AnimaApp, rollingBudget } from "../src/app.ts";
import { SYSTEM_PROMPT, type Fetcher } from "../src/advisor.ts";
import { loadConfig } from "../src/config.ts";
import { SCENES } from "../src/scenes.ts";

const MODEL = "test-model";
const live = { ...loadConfig({}, "missing.env"), advisor: { kind: "anthropic" as const, baseUrl: "http://model.test", model: MODEL, apiKey: "test-key" } };
const scene = (n: number) => SCENES.find((s) => s.n === n)!;

/** A stand-in provider: counts calls and answers each with status and text from the given function. */
function provider(answer: (system: string) => { status: number; text: string }) {
  const calls: string[] = [];
  const fetcher: Fetcher = async (_url, init) => {
    const system = JSON.parse(init.body).system as string;
    calls.push(system === SYSTEM_PROMPT ? "advice" : "council");
    const a = answer(system);
    return { status: a.status, json: async () => ({ content: [{ type: "text", text: a.text }] }) };
  };
  return { calls, fetcher };
}

const opinion = JSON.stringify({ stance: "NO_OBJECTION", reasons: ["Consistent."] });

test("a provider error falls back to the scene script, labelled, with the script's outcome", async () => {
  for (const status of [400, 401]) {
    const p = provider(() => ({ status, text: "" }));
    const app = new AnimaApp(live, { liveFallback: rollingBudget(10), advisorFetcher: p.fetcher });
    const run = await app.runScene(3);
    assert.equal(run.model, `scripted answers (live model unavailable: HTTP ${status})`);
    assert.deepEqual(run.advice.read, scene(3).invoice.scripted.read);
    assert.equal(run.outcome, "refused");
    assert.equal(run.receipt!.advisor, run.model, "the receipt names who really answered");
    assert.deepEqual(p.calls, ["advice"], "the council is the script's too: no further call to a failing provider");
  }
});

test("an unreachable provider falls back the same way", async () => {
  const fetcher: Fetcher = async () => { throw new Error("connect ECONNREFUSED"); };
  const app = new AnimaApp(live, { liveFallback: rollingBudget(10), advisorFetcher: fetcher });
  // withRetry waits 1 + 3 + 8 s before giving up on a network error; the test stays honest about it.
  const run = await app.runScene(1);
  assert.match(run.model, /^scripted answers \(live model unavailable: unreachable: connect ECONNREFUSED\)$/);
  assert.equal(run.outcome, "awaiting_payer");
});

test("past the live model's daily budget, the script answers without calling the provider", async () => {
  const p = provider(() => ({ status: 200, text: "" }));
  const app = new AnimaApp(live, { liveFallback: rollingBudget(0), advisorFetcher: p.fetcher });
  const run = await app.runScene(3);
  assert.equal(run.model, "scripted answers (the live model's daily budget is spent)");
  assert.equal(run.outcome, "refused");
  assert.equal(p.calls.length, 0);
});

test("a live answer stands, council included, and spends one run of the budget", async () => {
  const s1 = scene(1).invoice;
  const advice = JSON.stringify({ read: { invoice_number: s1.invoice.number, payee_address: s1.invoice.merchant, currency: s1.invoice.currency, amount_cents: s1.invoice.amount_cents }, recommendation: "PAY", reasons: ["Usual seat."] });
  const p = provider((system) => ({ status: 200, text: system === SYSTEM_PROMPT ? advice : opinion }));
  const budget = rollingBudget(1);
  const app = new AnimaApp(live, { liveFallback: budget, advisorFetcher: p.fetcher });
  const run = await app.runScene(1);
  assert.equal(run.model, MODEL);
  assert.equal(run.outcome, "awaiting_payer");
  assert.deepEqual(p.calls.sort(), ["advice", "council", "council"]);
  assert.equal(budget.take(), false, "the run took the only unit");
});

test("a malformed live answer is the model's own: no fallback, the fail-safe WAIT stands", async () => {
  const p = provider((system) => ({ status: 200, text: system === SYSTEM_PROMPT ? "I would pay it." : opinion }));
  const app = new AnimaApp(live, { liveFallback: rollingBudget(10), advisorFetcher: p.fetcher });
  const run = await app.runScene(1);
  assert.equal(run.model, MODEL);
  assert.equal(run.advice.recommendation, "WAIT");
  assert.equal(run.advice.unavailable, undefined);
});

test("without a safety net (the local desk), a provider error stays the fail-safe WAIT, never the script", async () => {
  const p = provider(() => ({ status: 401, text: "" }));
  const app = new AnimaApp(live, { advisorFetcher: p.fetcher });
  const run = await app.runScene(1);
  assert.equal(run.model, MODEL);
  assert.equal(run.advice.recommendation, "WAIT");
  assert.equal(run.advice.unavailable, "HTTP 401");
});

test("the rolling budget counts the last 24 hours", () => {
  let now = 0;
  const b = rollingBudget(2, () => now);
  assert.equal(b.take(), true);
  assert.equal(b.take(), true);
  assert.equal(b.take(), false);
  now = 86_400_001;
  assert.equal(b.take(), true);
});

test("scene 5's past months are replayed from the written answers, labelled: a live model's objection cannot stall the story", async () => {
  // A live model that objects to everything: before 30/10 its objection held a month that the replay
  // could not release (nobody may acknowledge a hold for a person), and the story stalled (6 runs in 40).
  const objection = JSON.stringify({ stance: "OBJECT", reasons: ["I do not like this invoice."] });
  const p = provider((system) => ({ status: 200, text: system === SYSTEM_PROMPT ? JSON.stringify({ read: { invoice_number: "X", merchant: "x", currency: "EUR", amount_cents: 1 }, recommendation: "WAIT", reasons: ["No."] }) : objection }));
  const app = new AnimaApp(live, { liveFallback: rollingBudget(10), advisorFetcher: p.fetcher });
  const run = await app.runScene(5);
  assert.deepEqual(p.calls, [], "the live model is not asked about months already lived");
  const story = app.state().receipts.filter((r) => /^DT-26(08|09|10)$/.test(r.request.invoice_number));
  assert.equal(story.length, 3);
  for (const r of story) {
    assert.equal(r.money_moved, true, r.request.invoice_number);
    assert.equal(r.advisor, "scripted answers (a past month, replayed)", "the receipt says who answered");
  }
  assert.equal(run.model, "scripted answers (a past month, replayed)");
  assert.equal(app.trust("billing@design-tool.example").proposal?.to_cents, 3_000);
  // Today's decisions stay the live model's: scene 1 asks it.
  await app.runScene(1);
  assert.ok(p.calls.includes("advice"));
});
