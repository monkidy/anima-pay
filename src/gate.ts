import { verdictOf, type Finding, type Verdict } from "./verdict.ts";
import type { Invoice, PastPayment, Proposal, SpendMandate } from "./model.ts";

const DAY_MS = 86_400_000;
/** Same payee and amount on invoices issued this close together looks like a second copy, not a new month. */
const DUPLICATE_WINDOW_DAYS = 20;

export interface GateResult {
  verdict: Verdict;
  findings: Finding[];
  /** True when a person must release the payment before any capture. */
  human_release_required: boolean;
}

/**
 * Decides whether a payment may go forward. The model's proposal can only make the
 * decision stricter: a PAY recommendation never opens a gate the mandate keeps shut,
 * while WAIT or REFUSE always stops the automatic flow and hands it to a person.
 */
export function checkPayment(input: {
  mandate: SpendMandate;
  invoice: Invoice;
  proposal: Proposal;
  history: readonly PastPayment[];
  now: Date;
}): GateResult {
  const { mandate, invoice, proposal, history, now } = input;
  const findings: Finding[] = [];
  type Params = Finding["params"];
  const fail = (id: string, message: string, params?: Params) => findings.push({ id, impact: "fail", message, ...(params ? { params } : {}) });
  const hold = (id: string, message: string, params?: Params) => findings.push({ id, impact: "hold", message, ...(params ? { params } : {}) });

  if (mandate.revoked) fail("MANDATE_REVOKED", "The mandate was revoked by its owner.");
  if (now.getTime() >= Date.parse(mandate.expires_at)) fail("MANDATE_EXPIRED", `The mandate expired on ${mandate.expires_at}.`, { date: mandate.expires_at.slice(0, 10) });
  if (invoice.currency !== mandate.currency) fail("CURRENCY_NOT_IN_MANDATE", `The mandate covers ${mandate.currency}, the invoice is in ${invoice.currency}.`, { mandate: mandate.currency, invoice: invoice.currency });
  if (!mandate.merchants.includes(invoice.merchant)) fail("MERCHANT_NOT_IN_MANDATE", `${invoice.merchant} is not a payee this mandate allows.`, { merchant: invoice.merchant });

  if (proposal.invoice_id !== invoice.id || proposal.merchant.toLowerCase() !== invoice.merchant.toLowerCase() ||
      proposal.currency.toUpperCase() !== invoice.currency.toUpperCase() || proposal.amount_cents !== invoice.amount_cents) {
    fail("PROPOSAL_DOES_NOT_MATCH_INVOICE", "The model proposed a payee, amount or currency that differs from the recorded invoice.");
  }

  if (invoice.amount_cents > mandate.max_per_payment_cents) fail("OVER_PER_PAYMENT_LIMIT", "The amount is above the per-payment limit.");

  const since = now.getTime() - mandate.period_days * DAY_MS;
  const inPeriod = history.filter((p) => p.currency === mandate.currency && Date.parse(p.captured_at) >= since);
  const spent = inPeriod.reduce((sum, p) => sum + p.amount_cents, 0);
  if (spent + invoice.amount_cents > mandate.max_per_period_cents) {
    fail("OVER_PERIOD_BUDGET", `Paying would bring the ${mandate.period_days}-day total above the mandate budget.`, { days: mandate.period_days });
  }

  if (history.some((p) => p.merchant === invoice.merchant && p.invoice_number === invoice.number)) {
    fail("INVOICE_ALREADY_PAID", `Invoice ${invoice.number} from ${invoice.merchant} was already paid.`, { number: invoice.number, merchant: invoice.merchant });
  } else if (inPeriod.some((p) => p.merchant === invoice.merchant && p.amount_cents === invoice.amount_cents &&
      Math.abs(Date.parse(p.issued_at ?? p.captured_at) - Date.parse(invoice.issued_at)) < DUPLICATE_WINDOW_DAYS * DAY_MS)) {
    hold("POSSIBLE_DUPLICATE", "Same payee and same amount already paid in this period.");
  }

  if (proposal.recommendation === "WAIT") hold("MODEL_ADVISES_WAIT", proposal.reasons.join(" ") || "The model advises to wait.", { reasons: proposal.reasons.join(" ") });
  if (proposal.recommendation === "REFUSE") hold("MODEL_ADVISES_REFUSE", proposal.reasons.join(" ") || "The model advises not to pay.", { reasons: proposal.reasons.join(" ") });

  if (proposal.council?.dissent) {
    const c = proposal.council;
    const voices = [c.adversary.stance === "OBJECT" ? `Adversary: ${c.adversary.reasons.join(" ")}` : "",
      c.verifier.stance === "OBJECT" ? `Verifier: ${c.verifier.reasons.join(" ")}` : ""].filter(Boolean);
    hold("COUNCIL_DISSENT", `The council did not agree. ${voices.join(" ")}`, { adversary: c.adversary.stance, verifier: c.verifier.stance });
  }

  const human_release_required = invoice.amount_cents > mandate.human_release_above_cents ||
    findings.some((f) => f.impact === "hold");
  if (invoice.amount_cents > mandate.human_release_above_cents) {
    findings.push({ id: "HUMAN_RELEASE_REQUIRED", impact: "info", message: "A person must release this payment before capture." });
  }

  return { verdict: verdictOf(findings), findings, human_release_required };
}
