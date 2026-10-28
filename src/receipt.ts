// Outbound Action Receipt, after the agent governance receipt standard (Apache-2.0, Hichem Benali,
// June 2026): what was asked, what actually ran, what did not run, and the evidence.
// A correction never overwrites: it is appended next to what it corrects (the golden seam).

import { PHRASES, type Finding, type Verdict } from "./verdict.ts";
import type { Deliberation } from "./council.ts";
import type { Resolved, ToolCall, ToolClass } from "./guard.ts";

export type ReceiptType = "ACTION_RECEIPT" | "REFUSAL_RECEIPT" | "BLOCKED_ACTION_RECEIPT" | "PARTIAL_ACTION_RECEIPT";
export type ReceiptStatus = "COMPLETED" | "REFUSED" | "DENIED" | "NOT_AUTHORIZED" | "PARTIAL" | "BLOCKED";

export interface ProviderEvidence {
  provider: "paypal-sandbox" | "paypal-sandbox-simulator";
  order_id?: string;
  order_status?: string;
  authorization_id?: string;
  authorization_status?: string;
  capture_id?: string;
  capture_status?: string;
  /** Who PayPal itself names as payee; on the sandbox a fictitious supplier is stood in for. */
  payee_at_paypal?: string;
  /** Who paid, as PayPal reports it; on the sandbox, possibly PayPal's test card standing in for a person. */
  payer_source?: string;
  checked_at: string;
}

export interface Correction {
  at: string;
  by: string;
  field: string;
  previous: string;
  replacement: string;
  reason: string;
}

export interface PaymentReceipt {
  schema: "anima.payment_receipt.v0";
  receipt_id: string;
  receipt_type: ReceiptType;
  status: ReceiptStatus;
  created_at: string;
  requested_action: string;
  request: { amount_cents: number; currency: string; merchant: string; invoice_number: string };
  actual_action: string;
  execution_started: boolean;
  money_moved: boolean;
  verdict: Verdict;
  line: string;
  boundary: {
    mandate_id: string;
    proposal_id: string;
    invoice_id: string;
    approval: "payer_on_paypal" | "payer_and_human_release" | "sandbox_test_card" | "sandbox_test_card_and_human_release" | "none";
    idempotency_key: string;
    boundary_respected: boolean;
  };
  findings: Finding[];
  /** The model behind the proposal, or the scripted stand-in when no model is configured. */
  advisor: string;
  /** Every voice of the council, dissent included, or null when no council sat. */
  deliberation: Deliberation | null;
  explanation: string;
  explanation_code: string;
  explanation_params: Record<string, string | number>;
  evidence: ProviderEvidence | null;
  corrections: Correction[];
}

export function correct(receipt: PaymentReceipt, c: Correction): PaymentReceipt {
  if (!(c.field in receipt)) throw new Error(`unknown receipt field: ${c.field}`);
  return { ...receipt, corrections: [...receipt.corrections, c] };
}

/** One call an agent asked of PayPal's own tools, and what became of it. Reads that pass leave none. */
export interface ToolReceipt {
  schema: "anima.tool_receipt.v0";
  receipt_id: string;
  receipt_type: ReceiptType;
  status: ReceiptStatus | "FAILED";
  created_at: string;
  call: ToolCall;
  klass: ToolClass | null;
  mandate_id: string;
  /** The facts the decision rested on, read from PayPal before the write. */
  resolved: Resolved;
  verdict: Verdict;
  line: string;
  findings: Finding[];
  release: { by: string; at: string; acknowledged: string[] } | null;
  /** True once PayPal ran the tool, whatever it answered. */
  executed: boolean;
  money_moved: boolean;
  /** PayPal's answer, trimmed to what a reader needs; never the token. */
  result: { is_error: boolean; ids: Record<string, string>; status: string | null; text: string } | null;
  explanation: string;
  explanation_code: string;
  explanation_params: Record<string, string | number>;
  provider: "paypal-sandbox-mcp" | "paypal-sandbox-mcp-simulator";
}

export function lineFor(verdict: Verdict): string {
  return PHRASES[verdict];
}
