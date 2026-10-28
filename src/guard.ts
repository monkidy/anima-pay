// The tool firewall: PayPal's own agent tools (its MCP server) behind ANIMA's locks. Every tool an agent
// may call is classed by what it can do to money or to people, and a tool nobody classed is refused. A
// tool that can move money, reach a customer or destroy a record passes the mandate first, then waits
// for a person above what the agent has earned. Reads pass. The facts a decision rests on (the amount
// of a refund, the recipients of an invoice) are read from PayPal before the write, never taken from
// the agent's own words.

import { verdictOf, type Finding, type Verdict } from "./verdict.ts";

const DAY_MS = 86_400_000;

/** read: looks only. money: can move money. outreach: reaches a customer or bills one.
 *  destructive: deletes or cancels. setup: changes records, moves no money, contacts no one. */
export type ToolClass = "read" | "money" | "outreach" | "destructive" | "setup";

/** The 46 tools PayPal's sandbox MCP server listed on 23/10/2026 ("PayPal MCP Agent" 1.0.0). */
export const TOOL_CLASSES: Readonly<Record<string, ToolClass>> = {
  list_invoices: "read", get_invoice: "read", get_recurring_series: "read", search_invoicing: "read",
  generate_invoice_qr_code: "read", generate_invoice_number: "read", list_products: "read",
  show_product_details: "read", list_subscription_plans: "read", show_subscription_plan_details: "read",
  show_subscription_details: "read", get_shipment_tracking: "read", get_order: "read", list_disputes: "read",
  get_dispute: "read", list_transactions: "read", get_refund: "read", get_merchant_insights: "read",

  pay_order: "money", create_refund: "money", accept_dispute_claim: "money", update_subscription: "money",

  send_invoice: "outreach", send_invoice_reminder: "outreach", cancel_sent_invoice: "outreach",
  create_subscription: "outreach", activate_recurring_series: "outreach",

  delete_invoice: "destructive", delete_recurring_series: "destructive", cancel_recurring_series: "destructive",
  cancel_subscription: "destructive", cancel_invoice_auto_reminder: "destructive",

  create_invoice: "setup", create_recurring_series: "setup", update_invoicing: "setup",
  setup_invoice_auto_reminders: "setup", update_invoice_auto_reminder: "setup",
  create_conditional_rules_for_invoice: "setup", create_product: "setup", update_product: "setup",
  create_subscription_plan: "setup", create_shipment_tracking: "setup", update_shipment_tracking: "setup",
  create_order: "setup", record_payment_for_invoice: "setup", record_refund_for_invoice: "setup",
};

export function classify(tool: string): ToolClass | null {
  return Object.hasOwn(TOOL_CLASSES, tool) ? TOOL_CLASSES[tool] : null;
}

/** What the owner lets an agent do with PayPal's tools. */
export interface ToolMandate {
  id: string;
  owner: string;
  purpose: string;
  allowed_classes: ToolClass[];
  currency: string;
  max_per_call_cents: number;
  max_per_period_cents: number;
  period_days: number;
  /** Above this amount, or when the amount cannot be known, a person must release the call. */
  human_release_above_cents: number;
  /** The only people outreach may reach. */
  recipients: string[];
  expires_at: string;
  revoked: boolean;
}

export interface ToolCall {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  /** The agent's own reason, kept in the receipt; never used to decide. */
  reason: string;
  agent: string;
  requested_at: string;
}

/** Facts read from PayPal before the decision. Absent means unknown, and unknown never opens a lock. */
export interface Resolved {
  amount_cents?: number;
  currency?: string;
  recipients?: string[];
}

export interface PastToolCall {
  tool: string;
  amount_cents: number;
  currency: string;
  at: string;
  /** The PayPal object it acted on, as `kind:id`. */
  target?: string;
}

export interface ToolGateResult {
  verdict: Verdict;
  klass: ToolClass | null;
  findings: Finding[];
  human_release_required: boolean;
}

export function checkToolCall(input: {
  mandate: ToolMandate;
  call: ToolCall;
  resolved: Resolved;
  history: readonly PastToolCall[];
  now: Date;
  /** The PayPal object this call acts on, as `kind:id`, for the repeated-call check. */
  target?: string;
}): ToolGateResult {
  const { mandate, call, resolved, history, now, target } = input;
  const findings: Finding[] = [];
  type Params = Finding["params"];
  const fail = (id: string, message: string, params?: Params) => findings.push({ id, impact: "fail", message, ...(params ? { params } : {}) });
  const hold = (id: string, message: string, params?: Params) => findings.push({ id, impact: "hold", message, ...(params ? { params } : {}) });
  const klass = classify(call.tool);

  if (!klass) {
    fail("TOOL_NOT_CLASSIFIED", `${call.tool} is not a tool this firewall knows; unknown tools are refused.`, { tool: call.tool });
    return { verdict: "fail", klass, findings, human_release_required: false };
  }
  if (mandate.revoked) fail("MANDATE_REVOKED", "The mandate was revoked by its owner.");
  if (now.getTime() >= Date.parse(mandate.expires_at)) fail("MANDATE_EXPIRED", `The mandate expired on ${mandate.expires_at}.`, { date: mandate.expires_at.slice(0, 10) });
  if (!mandate.allowed_classes.includes(klass)) fail("TOOL_CLASS_NOT_IN_MANDATE", `The mandate does not allow ${klass} tools such as ${call.tool}.`, { tool: call.tool, klass });
  if (klass === "read") return { verdict: verdictOf(findings), klass, findings, human_release_required: false };

  let release = false;
  if (klass === "money" || klass === "outreach") {
    if (resolved.amount_cents === undefined) {
      hold("AMOUNT_UNKNOWN", `The amount ${call.tool} would involve could not be read from PayPal; a person must decide.`, { tool: call.tool });
      release = true;
    } else {
      const amount = resolved.amount_cents;
      if (resolved.currency && resolved.currency.toUpperCase() !== mandate.currency.toUpperCase()) {
        fail("CURRENCY_NOT_IN_MANDATE", `The mandate covers ${mandate.currency}, this call is in ${resolved.currency}.`, { mandate: mandate.currency, invoice: resolved.currency });
      }
      if (amount > mandate.max_per_call_cents) {
        fail("OVER_PER_CALL_LIMIT", `${(amount / 100).toFixed(2)} is above the ${(mandate.max_per_call_cents / 100).toFixed(2)} allowed per call.`, { amount: amount / 100, limit: mandate.max_per_call_cents / 100 });
      }
      if (klass === "money") {
        const since = now.getTime() - mandate.period_days * DAY_MS;
        const spent = history.filter((h) => TOOL_CLASSES[h.tool] === "money" && Date.parse(h.at) >= since).reduce((s, h) => s + h.amount_cents, 0);
        if (spent + amount > mandate.max_per_period_cents) {
          fail("OVER_PERIOD_BUDGET", `${(spent / 100).toFixed(2)} already moved in ${mandate.period_days} days; this would pass the ${(mandate.max_per_period_cents / 100).toFixed(2)} budget.`, { spent: spent / 100, days: mandate.period_days, budget: mandate.max_per_period_cents / 100 });
        }
      }
      if (klass === "money" && target && history.some((h) => h.tool === call.tool && h.target === target)) {
        hold("REPEATED_CALL", `${call.tool} already ran on ${target}; a second run needs a person.`, { tool: call.tool, target });
        release = true;
      }
      if (amount > mandate.human_release_above_cents) release = true;
    }
  }
  if (klass === "outreach") {
    if (resolved.recipients === undefined) {
      hold("RECIPIENTS_UNKNOWN", `Who ${call.tool} would reach could not be read from PayPal; a person must decide.`, { tool: call.tool });
      release = true;
    } else {
      const allowed = new Set(mandate.recipients.map((r) => r.toLowerCase()));
      const outside = resolved.recipients.filter((r) => !allowed.has(r.toLowerCase()));
      if (outside.length) fail("RECIPIENT_NOT_IN_MANDATE", `${outside.join(", ")} is not someone this mandate lets the agent reach.`, { recipients: outside.join(", ") });
    }
  }
  if (klass === "destructive") {
    hold("DESTRUCTIVE_ACTION", `${call.tool} deletes or cancels something; a person must release it.`, { tool: call.tool });
    release = true;
  }
  if (release) findings.push({ id: "TOOL_RELEASE_REQUIRED", impact: "info", message: "A person must release this call before it reaches PayPal." });
  return { verdict: verdictOf(findings), klass, findings, human_release_required: release };
}
