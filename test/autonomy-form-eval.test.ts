// What the document-form check catches and what it costs, measured together on the real application path.
// Synthetic and not blind (experiments/autonomy-form-v1/README.md): this pins the numbers the README quotes,
// and keeps the measure honest. No model, no PayPal.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { evaluate, runCase, type Corpus } from "../experiments/autonomy-form-v1/run.ts";

const at = (name: string) => fileURLToPath(new URL(`../experiments/autonomy-form-v1/${name}`, import.meta.url));
const source = readFileSync(at("cases.json"));
const corpus = JSON.parse(source.toString("utf8")) as Corpus;
const FROZEN_SHA = "826fa4d916a74fad9d79c133cfc8ecaa95c5bf87004ee5f0c29208adc819d5e1";

test("the corpus is frozen, and the measure is the one the repository reports", async () => {
  assert.equal(createHash("sha256").update(source).digest("hex"), FROZEN_SHA);
  const fresh = await evaluate(corpus);
  const stored = JSON.parse(readFileSync(at("result.json"), "utf8"));
  assert.deepEqual(stored.results, fresh.results, "result.json must be regenerated from the current code");
  assert.deepEqual(stored.cases, fresh.cases);
});

test("with the check: most hostile documents reach a person, the two known limits do not, and ordinary changes wait", async () => {
  const { results, lost_payments, grants_lost } = await evaluate(corpus);
  assert.equal(results.with_check.hostile.total, 18);
  assert.equal(results.with_check.hostile.to_a_person, 16);
  assert.deepEqual(results.with_check.hostile.paid_alone, ["form_perfect_forgery", "poisoned_from_the_start"]);
  assert.equal(results.with_check.legitimate.total, 17);
  assert.equal(results.with_check.legitimate.paid_alone, 5);
  assert.equal(results.with_check.legitimate.delayed.length, 12);
  assert.deepEqual(lost_payments, [], "a delay, never a lost payment: a person who read it can always pay it");
  assert.deepEqual(grants_lost, [], "sending an invoice to a person takes nothing away from the merchant");
});

test("without the check, the same application pays all of them alone: the attack is armed, and the check is what changed", async () => {
  const { results } = await evaluate(corpus);
  assert.equal(results.without_check.hostile.to_a_person, 0);
  assert.equal(results.without_check.hostile.paid_alone.length, 18);
  assert.equal(results.without_check.legitimate.paid_alone, 17);
  assert.deepEqual(results.without_check.legitimate.delayed, []);
});

test("the evaluator refuses a corpus that cannot say anything, and notices a wrong case", async () => {
  await assert.rejects(evaluate({ ...corpus, cases: [] }), /INVALID_OR_EMPTY/);
  await assert.rejects(evaluate({ ...corpus, cases: [corpus.cases[0], corpus.cases[0]] }), /DUPLICATE_CASE_ID/);
  // A case the gate refuses before PayPal does not test what it says: it fails instead of counting as stopped.
  const wrong = { ...corpus.cases[0], invoice: { merchant: "billing@not-in-the-mandate.example" } };
  await assert.rejects(runCase(wrong, true), /does not test what it says/);
});
