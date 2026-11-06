// The payment desk: the only place where a proposal can turn into money, and only through
// three locks in order. The mandate (gate), the payer's approval on PayPal itself, and, when the
// gate asks for it, a person's release in the app. Every outcome, paid or not, leaves a receipt.

import { randomUUID } from "node:crypto";
import { documentForm } from "./form.ts";
import { checkPayment, type GateResult } from "./gate.ts";
import { Ledger, idempotencyKey } from "./ledger.ts";
import type { Invoice, PastPayment, Proposal, SpendMandate } from "./model.ts";
import { PayPalError, payeeOf, payerOf, type PayPalSandbox } from "./paypal.ts";
import { lineFor, type PaymentReceipt, type ProviderEvidence, type ReceiptStatus, type ReceiptType } from "./receipt.ts";

/** The English sentence a receipt keeps, plus a code and parameters so a screen can say it in another language. */
export interface Explanation {
  code: string;
  params: Record<string, string | number>;
  text: string;
}

/** A definitive refusal from PayPal (4xx). A 5xx or a lost connection is not one: the outcome is unknown. */
function refusedByPayPal(e: unknown): e is PayPalError {
  return e instanceof PayPalError && e.status >= 400 && e.status < 500;
}

function say(code: string, params: Record<string, string | number>, text: string): Explanation {
  return { code, params, text };
}

export interface PendingPayment {
  key: string;
  mandate: SpendMandate;
  invoice: Invoice;
  proposal: Proposal;
  gate: GateResult;
  order_id: string;
  approve_url: string | null;
  authorization_id: string | null;
  /** Set when PayPal's sandbox test card stood in for the payer. */
  stand_in?: "sandbox_test_card";
  /** Set once PayPal accepted a capture; a PENDING one is settled later, never counted as paid before. */
  capture_id?: string | null;
  /** The form of the document the model read, or null when the desk was given none. */
  document_form: string | null;
}

export interface HumanRelease {
  by: string;
  at: string;
  /** The hold findings the person read before releasing. Every one must be acknowledged. */
  acknowledged: string[];
}

export type ReviewOutcome =
  | { kind: "refused"; receipt: PaymentReceipt }
  | { kind: "awaiting_payer"; pending: PendingPayment };

export class PaymentDesk {
  private readonly paypal: PayPalSandbox;
  private readonly ledger: Ledger;
  private readonly invoices = new Map<string, Invoice>();
  private readonly pending = new Map<string, PendingPayment>();
  /** Payments being released right now: a second release of the same one waits for nothing and is refused. */
  private readonly releasing = new Set<string>();
  private readonly clock: () => Date;
  private readonly imported: () => PastPayment[];
  private readonly releaseThreshold: (mandate: SpendMandate, merchant: string) => number;
  private readonly earnedForms: ((merchant: string) => readonly string[]) | undefined;
  private readonly returnUrl: string | undefined;
  private readonly mandateNow: (m: SpendMandate) => SpendMandate;
  private readonly paypalScope: string | undefined;

  /** imported: payments made before this desk existed (a bank or PayPal statement), for duplicates and budgets. */
  /** releaseThreshold: above what amount a person must release, per merchant (earned trust); defaults to the mandate. */
  /** earnedForms: the document forms a person's grant rests on, per merchant; a payment only that grant would let through must be of one of them. */
  /** returnUrl: where PayPal sends the payer back after approving or cancelling. */
  /** mandateNow: the mandate as it stands at release time (revoked, expired, changed); defaults to the reviewed one. */
  /** paypalScope: for desks that share one PayPal account (a hosted demo, one desk per visitor), a tag that
   * makes this desk's request ids and PayPal invoice ids its own; PayPal then refuses a second payment of
   * an invoice within this desk only, and never replays another desk's answer. Without it, PayPal's memory
   * of an invoice is the account's, which is what a single real desk wants. */
  constructor(deps: { paypal: PayPalSandbox; ledger: Ledger; clock?: () => Date; imported?: () => PastPayment[]; releaseThreshold?: (mandate: SpendMandate, merchant: string) => number; earnedForms?: (merchant: string) => readonly string[]; returnUrl?: string; mandateNow?: (m: SpendMandate) => SpendMandate; paypalScope?: string }) {
    this.paypal = deps.paypal;
    this.ledger = deps.ledger;
    this.clock = deps.clock ?? (() => new Date());
    this.imported = deps.imported ?? (() => []);
    this.releaseThreshold = deps.releaseThreshold ?? ((m) => m.human_release_above_cents);
    // A desk given grants but not the forms behind them cannot say a document is covered: none is.
    this.earnedForms = deps.earnedForms ?? (deps.releaseThreshold ? () => [] : undefined);
    this.returnUrl = deps.returnUrl;
    this.mandateNow = deps.mandateNow ?? ((m) => m);
    this.paypalScope = deps.paypalScope;
  }

  /** The invoice id PayPal sees: the invoice's own number, scoped to this desk when it shares the account. */
  private paypalInvoiceId(invoice: Invoice): string {
    return this.paypalScope ? `${invoice.number}-${this.paypalScope}` : invoice.number;
  }

  /** What the gate compares, when this desk has grants to answer for. */
  private documentCheck(merchant: string, form: string | null) {
    return this.earnedForms ? { form, earned: this.earnedForms(merchant) } : undefined;
  }

  /** documentText: exactly what the model was given to read; its form is sealed in every receipt of this payment. */
  async review(mandate: SpendMandate, invoice: Invoice, proposal: Proposal, documentText?: string): Promise<ReviewOutcome> {
    this.invoices.set(invoice.id, invoice);
    const form = documentText === undefined ? null : documentForm(documentText, invoice);
    const key = idempotencyKey([...(this.paypalScope ? [this.paypalScope] : []), mandate.id, invoice.id, invoice.merchant, invoice.currency, invoice.amount_cents]);
    const history = [...this.imported(), ...this.ledger.pastPayments(this.invoices)];
    const threshold = Math.min(mandate.human_release_above_cents, this.releaseThreshold(mandate, invoice.merchant));
    const gate = checkPayment({ mandate: { ...mandate, human_release_above_cents: threshold }, invoice, proposal, history, now: this.clock(), document: this.documentCheck(invoice.merchant, form) });
    if (gate.verdict === "fail") {
      const receipt = this.receipt({
        type: "REFUSAL_RECEIPT", status: "NOT_AUTHORIZED", key, mandate, invoice, proposal, gate, form,
        actual: "none", started: false, moved: false, approval: "none", evidence: null,
        explanation: say("REFUSED_BY_GATE", {}, `Not paid. ${gate.findings.filter((f) => f.impact === "fail").map((f) => f.message).join(" ")} No PayPal call was made.`),
      });
      this.ledger.append(receipt);
      return { kind: "refused", receipt };
    }
    const order = await this.paypal.createOrder({
      requestId: `order-${key}`, invoiceNumber: this.paypalInvoiceId(invoice), payee: invoice.merchant,
      currency: invoice.currency, amountCents: invoice.amount_cents, description: invoice.description,
      returnUrl: this.returnUrl && `${this.returnUrl}?paypal=return`, cancelUrl: this.returnUrl && `${this.returnUrl}?paypal=cancel`,
    });
    const approve = (order.links ?? []).find((l: any) => l.rel === "approve" || l.rel === "payer-action");
    const pending: PendingPayment = { key, mandate, invoice, proposal, gate, order_id: order.id, approve_url: approve?.href ?? null, authorization_id: null, document_form: form };
    this.pending.set(key, pending);
    return { kind: "awaiting_payer", pending };
  }

  /** Called after the payer approved on PayPal. Captures only if every lock is open. */
  async release(key: string, human?: HumanRelease): Promise<PaymentReceipt> {
    if (this.releasing.has(key)) throw new Error(`payment ${key} is already being released`);
    this.releasing.add(key);
    try {
      return await this.releaseOnce(key, human);
    } finally {
      this.releasing.delete(key);
    }
  }

  private async releaseOnce(key: string, human?: HumanRelease): Promise<PaymentReceipt> {
    const p = this.mustGet(key);
    if (p.capture_id) return this.settle(p, human);
    const already = this.ledger.capturedFor(key);
    if (already) {
      return this.record(p, "BLOCKED_ACTION_RECEIPT", "BLOCKED", "none", false, false, "none",
        await this.evidence(p), say("ALREADY_CAPTURED", { receipt: already.receipt_id }, `Not paid again. This invoice was already captured (receipt ${already.receipt_id}).`), [{ id: "DOUBLE_CAPTURE", impact: "fail", message: "A capture already exists for this payment." }]);
    }
    const order = await this.paypal.getOrder(p.order_id);
    if (order.status !== "APPROVED" && !p.authorization_id) {
      return this.record(p, "BLOCKED_ACTION_RECEIPT", "BLOCKED", "none", false, false, "none",
        this.orderEvidence(order), say("PAYER_NOT_APPROVED", { status: order.status }, `Not paid. The payer has not approved this order on PayPal (status ${order.status}).`), [{ id: "PAYER_NOT_APPROVED", impact: "fail", message: "No payer approval on PayPal." }]);
    }
    const holds = p.gate.findings.filter((f) => f.impact === "hold").map((f) => f.id);
    if (p.gate.human_release_required) {
      const missing = human ? holds.filter((h) => !human.acknowledged.includes(h)) : holds;
      if (!human || missing.length > 0) {
        return this.record(p, "BLOCKED_ACTION_RECEIPT", "BLOCKED", "none", false, false, "payer_on_paypal",
          this.orderEvidence(order), human
            ? say("RELEASE_NOT_ACKNOWLEDGED", { missing: missing.join(", ") }, `Not paid yet. The release did not acknowledge: ${missing.join(", ")}.`)
            : say("RELEASE_REQUIRED", {}, "Not paid yet. A person must release this payment in the app."),
          [{ id: "HUMAN_RELEASE_MISSING", impact: "hold", message: "Waiting for a person's release." }]);
      }
    }
    // The decision was taken at review; the money moves now. Ask the mandate again, as it stands now:
    // expired, revoked, a budget spent in between, a new duplicate. Fails refuse; new holds need a person.
    const fresh = checkPayment({ mandate: { ...this.mandateNow(p.mandate), human_release_above_cents: Math.min(p.mandate.human_release_above_cents, this.releaseThreshold(p.mandate, p.invoice.merchant)) },
      invoice: p.invoice, proposal: p.proposal, history: [...this.imported(), ...this.ledger.pastPayments(this.invoices)], now: this.clock(), document: this.documentCheck(p.invoice.merchant, p.document_form) });
    if (fresh.verdict === "fail") return this.mandateChanged(p, fresh);
    const newHolds = fresh.findings.filter((f) => f.impact === "hold" && !holds.includes(f.id)).map((f) => f.id);
    // A signed trust grant may have been revoked AFTER review. The new threshold produces an
    // informational HUMAN_RELEASE_REQUIRED finding, not a hold. Checking newHolds alone would
    // let a previously autonomous payment capture without the now-required human release.
    const freshHumanMissing = fresh.human_release_required && !human;
    const unacknowledged = newHolds.filter((h) => !human?.acknowledged.includes(h));
    if (freshHumanMissing || unacknowledged.length) {
      p.gate = { ...fresh, human_release_required: true };
      return this.record(p, "BLOCKED_ACTION_RECEIPT", "BLOCKED", "none", false, false, "payer_on_paypal", this.orderEvidence(order),
        freshHumanMissing
          ? say("RELEASE_REQUIRED", {}, "Not paid yet. Permissions or trust changed since review; a person must release this payment before capture.")
          : say("RELEASE_NOT_ACKNOWLEDGED", { missing: unacknowledged.join(", ") },
              `Not paid yet. Since the review, new doubts appeared and were not acknowledged: ${unacknowledged.join(", ")}.`),
        [{ id: "HUMAN_RELEASE_MISSING", impact: "hold", message: "Waiting for a person's release under the current permission state." }]);
    }
    if (!p.authorization_id) {
      let authorized: any;
      try {
        authorized = await this.paypal.authorizeOrder(p.order_id, `authorize-${key}`);
      } catch (e) {
        if (refusedByPayPal(e)) return this.refusedByPayPal(p, "payer_on_paypal", e.issue ?? `HTTP ${e.status}`);
        throw e;
      }
      p.authorization_id = authorized.purchase_units?.[0]?.payments?.authorizations?.[0]?.id ?? null;
      if (!p.authorization_id) throw new PayPalError("PayPal returned no authorization", 502, authorized);
    }
    const capture = await this.paypal.captureAuthorization(p.authorization_id, `capture-${key}`);
    p.capture_id = capture.id;
    return this.captured(p, human, capture.id, capture.status, payeeOf(order), payerOf(order));
  }

  /** PayPal's capture status decides the receipt: only COMPLETED is paid. PENDING means PayPal has not
   *  credited the payee yet: a partial receipt, no money counted, no trust earned, settled later. */
  private captured(p: PendingPayment, human: HumanRelease | undefined, captureId: string, status: string, payee?: string, payer?: string): PaymentReceipt {
    const evidence: ProviderEvidence = { provider: this.paypal.provider, order_id: p.order_id, authorization_id: p.authorization_id ?? undefined, capture_id: captureId, capture_status: status, payee_at_paypal: payee, payer_source: payer, checked_at: this.clock().toISOString() };
    const card = p.stand_in === "sandbox_test_card";
    const approval = card ? (human ? "sandbox_test_card_and_human_release" : "sandbox_test_card") : (human ? "payer_and_human_release" : "payer_on_paypal");
    const released = human ? `, and ${human.by} released it` : "";
    if (status === "PENDING") {
      return this.record(p, "PARTIAL_ACTION_RECEIPT", "PARTIAL", `capture ${captureId}`, true, false, approval, evidence,
        say("CAPTURE_PENDING", {}, `Not paid yet. PayPal accepted the capture but has not credited it (PENDING); it counts as paid only once PayPal says COMPLETED.`),
        [{ id: "CAPTURE_PENDING", impact: "hold", message: "PayPal has not settled the capture yet." }]);
    }
    this.pending.delete(p.key);
    if (status !== "COMPLETED") {
      return this.record(p, "BLOCKED_ACTION_RECEIPT", "BLOCKED", `capture ${captureId}`, true, false, approval, evidence,
        say("CAPTURE_STATUS", { status }, `Not paid. PayPal's capture ended ${status}.`), [{ id: "CAPTURE_NOT_COMPLETED", impact: "fail", message: `PayPal capture status ${status}.` }]);
    }
    return this.record(p, "ACTION_RECEIPT", "COMPLETED", `capture ${captureId}`, true, true, approval, evidence,
      card ? say("PAID_TEST_PAYER", human ? { by: human.by } : {}, `Paid on the sandbox. The mandate allowed it, PayPal's sandbox test card stood in for the payer${released}.`)
        : say("PAID", human ? { by: human.by } : {}, `Paid. The mandate allowed it, the payer approved it on PayPal${released}.`), []);
  }

  /** A capture PayPal left PENDING: ask PayPal again; a new receipt only when its status moved. */
  private async settle(p: PendingPayment, human?: HumanRelease): Promise<PaymentReceipt> {
    const capture = await this.paypal.getCapture(p.capture_id!);
    if (capture.status === "PENDING") return this.ledger.all().filter((r) => r.boundary.idempotency_key === p.key).pop()!;
    return this.captured(p, human, capture.id, capture.status);
  }

  /** The mandate no longer allows a payment it allowed at review: refused, any held funds released. */
  private async mandateChanged(p: PendingPayment, fresh: GateResult): Promise<PaymentReceipt> {
    let evidence: ProviderEvidence = { provider: this.paypal.provider, order_id: p.order_id, checked_at: this.clock().toISOString() };
    if (p.authorization_id) {
      await this.paypal.voidAuthorization(p.authorization_id, `void-${p.key}`);
      const auth = await this.paypal.getAuthorization(p.authorization_id);
      evidence = { ...evidence, authorization_id: p.authorization_id, authorization_status: auth.status };
    }
    this.pending.delete(p.key);
    const fails = fresh.findings.filter((f) => f.impact === "fail");
    return this.record({ ...p, gate: fresh }, "REFUSAL_RECEIPT", "NOT_AUTHORIZED", "none", false, false, "none", evidence,
      say("MANDATE_CHANGED", {}, `Not paid. Between the review and the release, the mandate stopped allowing this payment: ${fails.map((f) => f.message).join(" ")}`),
      [{ id: "MANDATE_CHANGED_BEFORE_CAPTURE", impact: "fail", message: "Re-checked at release time, the mandate no longer allows this payment." }]);
  }

  /** A person says no. If funds are held, they are released back; the receipt proves nothing was taken. */
  async decline(key: string, by: string, reason: string): Promise<PaymentReceipt> {
    const p = this.mustGet(key);
    let evidence: ProviderEvidence;
    if (p.authorization_id) {
      await this.paypal.voidAuthorization(p.authorization_id, `void-${key}`);
      const auth = await this.paypal.getAuthorization(p.authorization_id);
      evidence = { provider: this.paypal.provider, order_id: p.order_id, authorization_id: p.authorization_id, authorization_status: auth.status, checked_at: this.clock().toISOString() };
    } else {
      evidence = this.orderEvidence(await this.paypal.getOrder(p.order_id));
    }
    const receipt = this.record(p, "REFUSAL_RECEIPT", "REFUSED", "none", false, false, "none", evidence,
      say("DECLINED", { by, reason }, `Not paid. ${by} declined: ${reason}. PayPal shows no capture for this order.`), [{ id: "DECLINED_BY_HUMAN", impact: "fail", message: reason }]);
    this.pending.delete(key);
    return receipt;
  }

  /** What PayPal says right now about a waiting payment: has the payer approved it on PayPal? */
  async payerStatus(key: string): Promise<{ order_id: string; status: string; payer_approved: boolean; stand_in: string | null }> {
    const p = this.mustGet(key);
    const order = await this.paypal.getOrder(p.order_id);
    return { order_id: p.order_id, status: order.status, payer_approved: order.status === "APPROVED" || Boolean(p.authorization_id), stand_in: p.stand_in ?? null };
  }

  /** Sandbox only: PayPal's published test card stands in for the payer, so the money path (authorize,
   * then capture once the other locks are open) is proven without anyone signing in to PayPal as a
   * payer. It is a new order, paid by that card; the waiting order is left unapproved, and every receipt
   * of this payment says who stood in. The mandate and the person's release still apply. */
  async standInTestPayer(key: string): Promise<{ order_id: string; authorization_id: string } | { blocked: PaymentReceipt }> {
    const p = this.mustGet(key);
    if (p.authorization_id) throw new Error("this payment already holds a PayPal authorization");
    let order: any;
    try {
      order = await this.paypal.createOrder({
        requestId: `card-${key}`, invoiceNumber: this.paypalInvoiceId(p.invoice), payee: p.invoice.merchant,
        currency: p.invoice.currency, amountCents: p.invoice.amount_cents, description: p.invoice.description, testCard: true,
      });
    } catch (e) {
      if (refusedByPayPal(e)) return { blocked: this.refusedByPayPal(p, "none", e.issue ?? `HTTP ${e.status}`) };
      throw e;
    }
    const payments = order.purchase_units?.[0]?.payments ?? {};
    const auth = payments.authorizations?.[0];
    if (!auth?.id || auth.status !== "CREATED") {
      // PayPal answered, but with no fresh authorization: an already captured one (a replay of a paid
      // order) means the invoice is paid; anything else is a refusal. Either way, sealed, nothing taken.
      const paid = auth?.status === "CAPTURED" || (payments.captures ?? []).length > 0;
      const issue = paid ? "DUPLICATE_INVOICE_ID" : `AUTHORIZATION_${auth?.status ?? "MISSING"}`;
      p.order_id = order.id ?? p.order_id;
      return { blocked: this.refusedByPayPal(p, "none", issue) };
    }
    Object.assign(p, { order_id: order.id, approve_url: null, authorization_id: auth.id, stand_in: "sandbox_test_card" });
    return { order_id: order.id, authorization_id: auth.id };
  }

  /** PayPal itself refused the payment (a 4xx answer: definitive, nothing taken). The refusal is sealed
   *  like any outcome. DUPLICATE_INVOICE_ID means PayPal already holds this invoice as paid: even when this
   *  desk forgot (a lost ledger, another desk), PayPal remembered. */
  private refusedByPayPal(p: PendingPayment, approval: PaymentReceipt["boundary"]["approval"], issue: string): PaymentReceipt {
    this.pending.delete(p.key);
    const evidence: ProviderEvidence = { provider: this.paypal.provider, order_id: p.order_id, checked_at: this.clock().toISOString() };
    if (issue === "DUPLICATE_INVOICE_ID") {
      return this.record(p, "BLOCKED_ACTION_RECEIPT", "BLOCKED", "none", false, false, approval, evidence,
        say("ALREADY_PAID_AT_PAYPAL", { invoice: p.invoice.number }, `Not paid again. PayPal already holds a completed payment for invoice ${p.invoice.number} (DUPLICATE_INVOICE_ID).`),
        [{ id: "ALREADY_PAID_AT_PAYPAL", impact: "fail", message: `PayPal refused a second payment for invoice ${p.invoice.number}.`, params: { invoice: p.invoice.number } }]);
    }
    return this.record(p, "BLOCKED_ACTION_RECEIPT", "BLOCKED", "none", false, false, approval, evidence,
      say("REFUSED_BY_PAYPAL", { issue }, `Not paid. PayPal refused the payment (${issue}); nothing was taken.`),
      [{ id: "PAYPAL_REFUSED_PAYMENT", impact: "fail", message: `PayPal refused the payment: ${issue}.`, params: { issue } }]);
  }

  pendingList(): PendingPayment[] {
    return [...this.pending.values()];
  }

  private mustGet(key: string): PendingPayment {
    const p = this.pending.get(key);
    if (!p) throw new Error(`no pending payment for ${key}`);
    return p;
  }

  private orderEvidence(order: any): ProviderEvidence {
    return { provider: this.paypal.provider, order_id: order.id, order_status: order.status, payee_at_paypal: payeeOf(order), checked_at: this.clock().toISOString() };
  }

  private async evidence(p: PendingPayment): Promise<ProviderEvidence> {
    return this.orderEvidence(await this.paypal.getOrder(p.order_id));
  }

  private record(p: PendingPayment, type: ReceiptType, status: ReceiptStatus, actual: string, started: boolean, moved: boolean,
    approval: PaymentReceipt["boundary"]["approval"], evidence: ProviderEvidence | null, explanation: Explanation, extra: PaymentReceipt["findings"]): PaymentReceipt {
    const receipt = this.receipt({ type, status, key: p.key, mandate: p.mandate, invoice: p.invoice, proposal: p.proposal, gate: p.gate, form: p.document_form, actual, started, moved, approval, evidence, explanation, extra });
    this.ledger.append(receipt);
    return receipt;
  }

  private receipt(a: { type: ReceiptType; status: ReceiptStatus; key: string; mandate: SpendMandate; invoice: Invoice; proposal: Proposal; gate: GateResult; form: string | null;
    actual: string; started: boolean; moved: boolean; approval: PaymentReceipt["boundary"]["approval"]; evidence: ProviderEvidence | null; explanation: Explanation; extra?: PaymentReceipt["findings"] }): PaymentReceipt {
    const findings = [...a.gate.findings, ...(a.extra ?? [])];
    const verdict = a.moved ? "pass" : findings.some((f) => f.impact === "fail") ? "fail" : "hold";
    return {
      schema: "anima.payment_receipt.v0",
      receipt_id: randomUUID(),
      receipt_type: a.type,
      status: a.status,
      created_at: this.clock().toISOString(),
      requested_action: `pay ${(a.invoice.amount_cents / 100).toFixed(2)} ${a.invoice.currency} to ${a.invoice.merchant} for invoice ${a.invoice.number}`,
      request: { amount_cents: a.invoice.amount_cents, currency: a.invoice.currency, merchant: a.invoice.merchant, invoice_number: a.invoice.number },
      actual_action: a.actual,
      execution_started: a.started,
      money_moved: a.moved,
      verdict,
      line: lineFor(verdict),
      boundary: { mandate_id: a.mandate.id, proposal_id: a.proposal.id, invoice_id: a.invoice.id, approval: a.approval, idempotency_key: a.key, boundary_respected: true },
      findings,
      advisor: a.proposal.model,
      deliberation: a.proposal.council ?? null,
      explanation: a.explanation.text,
      explanation_code: a.explanation.code,
      explanation_params: a.explanation.params,
      evidence: a.evidence,
      ...(a.form ? { document_form: a.form } : {}),
      corrections: [],
    };
  }
}
