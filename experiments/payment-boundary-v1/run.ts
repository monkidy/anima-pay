// Synthetic financial action-boundary evaluation, not a model benchmark.
// Curated fixtures deliberately include two threats current code may miss.
// Oracle labels were hand-authored separately from checkPayment(), but not blindly or by an independent assessor.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { documentForm } from "../../src/form.ts";
import { checkPayment } from "../../src/gate.ts";
import { toPayPalValue, type Invoice, type PastPayment, type Proposal, type SpendMandate } from "../../src/model.ts";
import type { GateResult } from "../../src/gate.ts";

type Action = "AUTO" | "REVIEW" | "BLOCK";
type Group = "benign" | "mandate" | "proposal" | "review" | "injection";
interface Case {
  id: string; category: Group; oracle_action: Action; reason?: string;
  mandate?: Partial<SpendMandate>; invoice?: Partial<Invoice>;
  proposal?: Partial<Proposal>; history?: PastPayment[];
}
interface Corpus {
  schema: string; frozen_at_utc: string; evaluation_time_utc: string;
  base: { mandate: SpendMandate; invoice: Invoice };
  cases: Case[];
}
export function classifyGate(g: GateResult): Action {
  if (g.verdict === "fail") return "BLOCK";
  return g.verdict === "hold" || g.human_release_required ? "REVIEW" : "AUTO";
}
// A bounded, ordinary mandate-only control, rather than a fantasy incompetent model.
// It honours permission, limits, time, exact paid invoice, and human threshold.
// Intentionally does not inspect LLM-vs-record mismatch, fuzzy duplicates or the council.
export function simpleMandateAction(x: {
  mandate: SpendMandate; invoice: Invoice; proposal: Proposal;
  history: PastPayment[]; now: Date;
}): Action {
  const { mandate: m, invoice: i, proposal: p, history, now } = x;
  if (m.revoked || now.getTime() >= Date.parse(m.expires_at) ||
      i.currency !== m.currency || !m.merchants.includes(i.merchant) ||
      i.amount_cents > m.max_per_payment_cents) return "BLOCK";
  const spent = history.filter(h => h.currency === m.currency &&
    Date.parse(h.captured_at) >= now.getTime() - m.period_days * 86_400_000)
    .reduce((sum, h) => sum + h.amount_cents, 0);
  if (spent + i.amount_cents > m.max_per_period_cents ||
      history.some(h => h.merchant === i.merchant && h.invoice_number === i.number)) return "BLOCK";
  if (p.recommendation !== "PAY" || i.amount_cents > m.human_release_above_cents) return "REVIEW";
  return "AUTO";
}
/**
 * The document a case's recorded invoice stands for. The corpus has no invoice text (its two injections sit in
 * the description), so the earned-autonomy run prints the recorded fields in one fixed layout. Written after the
 * labels were frozen, by the same author; it is a modelling choice, stated as such in the README.
 */
export function documentOf(i: Invoice): string {
  return `Invoice ${i.number}\n${i.description}\nAmount due: ${toPayPalValue(i.amount_cents)} ${i.currency}\nPay to ${i.merchant}`;
}
/** The same case as if a person's grant, resting on documents of the base invoice's form for that payee, set the threshold. */
export function earnedDocument(corpus: Corpus, inputs: ReturnType<typeof buildCase>) {
  const paidBefore = { ...corpus.base.invoice, merchant: inputs.invoice.merchant };
  return { form: documentForm(documentOf(inputs.invoice), inputs.invoice), earned: [documentForm(documentOf(paidBefore), paidBefore)!] };
}
export function buildCase(corpus: Corpus, c: Case) {
  const mandate = { ...corpus.base.mandate, ...(c.mandate ?? {}) };
  const invoice = { ...corpus.base.invoice, ...(c.invoice ?? {}) };
  // The test proposer faithfully copies record fields unless the case explicitly forges them.
  const proposal: Proposal = {
    id: "shadow-" + c.id, invoice_id: invoice.id, merchant: invoice.merchant,
    currency: invoice.currency, amount_cents: invoice.amount_cents,
    recommendation: "PAY", reasons: ["Synthetic PAY recommendation"],
    model: "synthetic-fixed-proposal-NOT-LLM",
    ...(c.proposal ?? {}),
  };
  return { mandate, invoice, proposal, history: c.history ?? [],
    now: new Date(corpus.evaluation_time_utc) };
}
export function evaluate(corpus: Corpus) {
  if (corpus.schema !== "anima.synthetic_payment_boundary_eval.v1" ||
      !Array.isArray(corpus.cases) || corpus.cases.length === 0)
    throw new Error("INVALID_OR_EMPTY_EVALUATION_CORPUS");
  const ids = corpus.cases.map(x => x.id);
  if (new Set(ids).size !== ids.length) throw new Error("DUPLICATE_CASE_ID");
  const allowed = new Set(["AUTO", "REVIEW", "BLOCK"]);
  const rows = corpus.cases.map(c => {
    if (!allowed.has(c.oracle_action)) throw new Error("INVALID_ORACLE:" + c.id);
    const inputs = buildCase(corpus, c);
    const real = checkPayment(inputs);
    const actual = classifyGate(real);
    const earned = classifyGate(checkPayment({ ...inputs, document: earnedDocument(corpus, inputs) }));
    const simple = simpleMandateAction(inputs);
    const proposalOnly: Action = inputs.proposal.recommendation === "PAY" ? "AUTO" : "REVIEW";
    return { id: c.id, category: c.category, oracle: c.oracle_action, anima: actual,
      animaEarned: earned, simple, proposalOnly, agreed: c.oracle_action === actual,
      reasonIds: real.findings.filter(f=> f.impact !== "info").map(f => f.id),
      source: "STRUCTURED_GATE_ONLY", modelRan: false, paypalCalled: false };
  });
  function summary(key: "anima" | "animaEarned" | "simple" | "proposalOnly") {
    const mismatched = rows.filter(r => r[key] !== r.oracle);
    return {
      correct: rows.length - mismatched.length,
      mismatches: mismatched.map(r => r.id),
      risky_auto_admissions: rows.filter(r => r.oracle !== "AUTO" && r[key] === "AUTO").map(r => r.id),
      legitimate_delays: rows.filter(r => r.oracle === "AUTO" && r[key] !== "AUTO").map(r => r.id),
    };
  }
  const counts = Object.fromEntries([...new Set(rows.map(r => r.category))].sort().map(cat =>
    [cat, {total:rows.filter(r => r.category === cat).length,
      expected: Object.fromEntries(["AUTO","REVIEW","BLOCK"].map(k => [k, rows.filter(r => r.category === cat && r.oracle === k).length])),
      animaMisses: rows.filter(r => r.category === cat && !r.agreed).length}]));
  return { schema:"anima.synthetic_payment_boundary_eval_result.v1", fixtureSource:corpus.schema,
    sampleSize:rows.length, scope:"hand-picked structured synthetic cases; NO REAL LLM, NO PAYPAL, NO REAL MONEY",
    baselines:{proposalOnly:"fixed synthetic proposer without authorization boundary; NOT a real LLM",
      simple:"deterministic basic mandate-only check; NOT a competitor product"},
    caveat:"No prospective holdout, statistical confidence, independent human oracle, real model or provider effect. Do not claim market or LLM superiority.",
    runs:{anima:"the gate alone, given no document: the original run",
      animaEarned:"the same gate where a person's grant sets the threshold, comparing each case's document with the form of the payments behind that grant"},
    results:{anima:summary("anima"),animaEarned:summary("animaEarned"),simple:summary("simple"),proposalOnly:summary("proposalOnly")},
    breakdown:counts, cases:rows };
}
export function fixtureAt(path: string): Corpus {
  return JSON.parse(readFileSync(path, "utf8")) as Corpus;
}
if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === process.argv[1].toLowerCase()) {
  const fixturePath = fileURLToPath(new URL("./cases.json", import.meta.url));
  const source = readFileSync(fixturePath);
  const outcome = evaluate(JSON.parse(source.toString("utf8")));
  const artifact = {...outcome, fixtureSha256: createHash("sha256").update(source).digest("hex")};
  const output = fileURLToPath(new URL("./result.json", import.meta.url));
  writeFileSync(output, JSON.stringify(artifact, null, 2) + "\n");
  console.log(JSON.stringify({n:artifact.sampleSize,results:artifact.results,breakdown:artifact.breakdown,fixtureSha256:artifact.fixtureSha256,resultPath:output},null,2));
}
