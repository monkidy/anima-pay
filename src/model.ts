// Data model, after the agent governance receipt standard (Apache-2.0, Hichem Benali, June 2026):
// a Mandate says what the agent may spend, a Proposal is what the agent suggests, a Receipt records
// what happened and what did not happen. Amounts are integer cents: no floating point near money.

/** What the agent is allowed to spend. Written by the human, never by the model. */
export interface SpendMandate {
  id: string;
  purpose: string;
  currency: string;
  max_per_payment_cents: number;
  max_per_period_cents: number;
  period_days: number;
  /** Payees the agent may pay, as PayPal merchant ids or e-mail addresses. */
  merchants: string[];
  /** Above this amount a person must release the payment in the app. 0 means every payment. */
  human_release_above_cents: number;
  expires_at: string;
  revoked: boolean;
}

/** The invoice as the human recorded it. Trusted: the model may read it, not rewrite it. */
export interface Invoice {
  id: string;
  number: string;
  merchant: string;
  currency: string;
  amount_cents: number;
  issued_at: string;
  description: string;
}

import type { Deliberation } from "./council.ts";

/** What the model suggests. Untrusted input, even when it is right. */
export interface Proposal {
  id: string;
  invoice_id: string;
  recommendation: "PAY" | "WAIT" | "REFUSE";
  merchant: string;
  currency: string;
  amount_cents: number;
  reasons: string[];
  model: string;
  /** The council's three voices on this proposal, when a council sat. */
  council?: Deliberation | null;
}

/** A payment that already left, as the ledger remembers it. */
export interface PastPayment {
  invoice_number: string;
  merchant: string;
  currency: string;
  amount_cents: number;
  captured_at: string;
  /** When the paid invoice was issued: what tells a monthly bill from a second copy. */
  issued_at?: string;
}

export function toPayPalValue(cents: number): string {
  if (!Number.isInteger(cents) || cents <= 0) throw new Error(`invalid amount in cents: ${cents}`);
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}
