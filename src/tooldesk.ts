// The tool desk: where an agent's call to PayPal's own tools meets ANIMA's locks. It reads the facts
// from PayPal first, asks the firewall, then runs the call, holds it for a person, or refuses it, and
// seals a receipt for every outcome except a read that passed. A call PayPal may or may not have run
// is never retried blindly: its receipt says the outcome is unknown.

import { randomUUID } from "node:crypto";
import { checkToolCall, classify, type Resolved, type ToolCall, type ToolGateResult, type ToolMandate } from "./guard.ts";
import { type Ledger, targetOf } from "./ledger.ts";
import type { ToolBackend, ToolResult } from "./mcp.ts";
import { lineFor, type ToolReceipt } from "./receipt.ts";
import type { Explanation, HumanRelease } from "./desk.ts";
import type { Finding, Verdict } from "./verdict.ts";

export type Resolver = (call: ToolCall, tools: ToolBackend) => Promise<Resolved>;

export interface PendingToolCall {
  call: ToolCall;
  gate: ToolGateResult;
  resolved: Resolved;
  target?: string;
}

export type ToolOutcome =
  | { kind: "read"; result: ToolResult }
  | { kind: "done"; receipt: ToolReceipt }
  | { kind: "refused"; receipt: ToolReceipt }
  | { kind: "held"; pending: PendingToolCall };

function say(code: string, params: Record<string, string | number>, text: string): Explanation {
  return { code, params, text };
}

/** A PayPal money object ({currency_code, value}) as cents, or nothing when it is not one. */
export function moneyOf(x: any): { amount_cents: number; currency: string } | undefined {
  if (!x || typeof x.value !== "string" || !/^\d+(\.\d{1,2})?$/.test(x.value) || typeof x.currency_code !== "string") return undefined;
  const [units, cents = ""] = x.value.split(".");
  return { amount_cents: Number(units) * 100 + Number(cents.padEnd(2, "0")), currency: x.currency_code.toUpperCase() };
}

function parsed(result: ToolResult | null | undefined): any {
  const text = result?.content?.find((c) => c.type === "text")?.text;
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

/**
 * Whether PayPal's tool failed. PayPal's MCP server does not always flag a failure: observed 23/10, a
 * 403 came back as a normal answer whose text is {"ok":false,"status":403,...}. Trusting the flag alone
 * would seal "refunded, money moved" for a refund PayPal refused.
 */
export function paypalFailed(result: ToolResult | null | undefined): boolean {
  if (!result || result.isError) return true;
  return parsed(result)?.ok === false;
}

/**
 * Why PayPal's tool failed, in the codes of PayPal's own agent toolkit (handleAxiosError in its
 * src/shared/functions.ts, @paypal/agent-toolkit 1.11.0): PAYPAL_API_SETUP_ERROR is raised before the
 * request is sent to PayPal's payments API, PAYPAL_API_NO_RESPONSE after it was sent and nothing came
 * back. Anything else is PayPal's answer, a refusal. Observed 29/10: every call, reads included, came
 * back PAYPAL_API_SETUP_ERROR "Unsupported cache mode: default" while PayPal's REST API answered the
 * same token; sealing that as "PayPal refused" was false.
 */
export function paypalFailure(result: ToolResult | null | undefined): "refused" | "not_sent" | "no_answer" | null {
  if (!paypalFailed(result)) return null;
  const code = parsed(result)?.code;
  return code === "PAYPAL_API_SETUP_ERROR" ? "not_sent" : code === "PAYPAL_API_NO_RESPONSE" ? "no_answer" : "refused";
}

/** The JSON PayPal's tool answered with, or null when it answered with prose or a failure. */
/** The code and message PayPal's tool answered with, when it failed. */
export function paypalError(result: ToolResult | null | undefined): { code: string; message: string } | null {
  const p = paypalFailed(result) ? parsed(result) : null;
  return p && typeof p === "object" ? { code: String(p.code ?? ""), message: String(p.message ?? "") } : null;
}

export function jsonOf(result: ToolResult | null | undefined): any {
  return paypalFailed(result) ? null : parsed(result);
}

/**
 * Reads, from PayPal, the facts a write would rest on: what a refund would return (the capture), what
 * accepting a dispute would cost, what capturing an order would take, and whom an invoice would reach.
 */
export function paypalFacts(deps: { capture: (id: string) => Promise<any> }): Resolver {
  return async (call, tools) => {
    const a = call.args;
    const read = async (tool: string, args: Record<string, unknown>) => {
      try { return jsonOf(await tools.callTool(tool, args)); } catch { return null; }
    };
    switch (call.tool) {
      case "create_refund": {
        const capture = typeof a.capture_id === "string" ? await deps.capture(a.capture_id).catch(() => null) : null;
        const captured = moneyOf(capture?.amount);
        const asked = a.amount === undefined ? undefined : moneyOf(a.amount);
        if (a.amount !== undefined && !asked) return {};
        return asked ?? captured ?? {};
      }
      case "accept_dispute_claim":
        return moneyOf((await read("get_dispute", { dispute_id: a.dispute_id }))?.dispute_amount) ?? {};
      case "pay_order":
        return moneyOf((await read("get_order", { id: a.id }))?.purchase_units?.[0]?.amount) ?? {};
      case "send_invoice": case "send_invoice_reminder": case "cancel_sent_invoice": {
        const invoice = await read("get_invoice", { invoice_id: a.invoice_id });
        if (!invoice) return {};
        const primary = a.send_to_recipient === false ? [] : (invoice.primary_recipients ?? []).map((r: any) => r?.billing_info?.email_address).filter(Boolean);
        const extra = Array.isArray(a.additional_recipients) ? a.additional_recipients.map(String) : [];
        return { ...(moneyOf(invoice.amount) ?? {}), recipients: [...primary, ...extra] };
      }
      default:
        return {};
    }
  };
}

export class ToolDesk {
  private readonly tools: ToolBackend;
  private readonly ledger: Ledger;
  private readonly mandate: () => ToolMandate;
  private readonly resolver: Resolver;
  private readonly clock: () => Date;
  private readonly provider: ToolReceipt["provider"];
  private readonly pending = new Map<string, PendingToolCall>();

  constructor(deps: { tools: ToolBackend; ledger: Ledger; mandate: () => ToolMandate; resolver: Resolver; provider: ToolReceipt["provider"]; clock?: () => Date }) {
    this.tools = deps.tools;
    this.ledger = deps.ledger;
    this.mandate = deps.mandate;
    this.resolver = deps.resolver;
    this.provider = deps.provider;
    this.clock = deps.clock ?? (() => new Date());
  }

  async request(call: ToolCall): Promise<ToolOutcome> {
    if (this.pending.has(call.id) || this.ledger.toolExecuted(call.id)) throw new Error(`call ${call.id} was already requested`);
    const klass = classify(call.tool);
    const target = targetOf(call.args);
    const resolved = klass === "money" || klass === "outreach" ? await this.resolver(call, this.tools).catch(() => ({})) : {};
    const gate = checkToolCall({ mandate: this.mandate(), call, resolved, history: this.ledger.pastToolCalls(), now: this.clock(), target });
    if (gate.verdict === "fail") {
      const fails = gate.findings.filter((f) => f.impact === "fail").map((f) => f.message).join(" ");
      return { kind: "refused", receipt: this.seal({ call, gate, resolved, type: "REFUSAL_RECEIPT", status: "NOT_AUTHORIZED", release: null, result: null, executed: false,
        explanation: say("TOOL_REFUSED", { tool: call.tool }, `Not run. ${fails} PayPal was not asked to ${call.tool}.`) }) };
    }
    if (klass === "read") return { kind: "read", result: await this.tools.callTool(call.tool, call.args) };
    const pending: PendingToolCall = { call, gate, resolved, target };
    if (gate.human_release_required) {
      this.pending.set(call.id, pending);
      return { kind: "held", pending };
    }
    return { kind: "done", receipt: await this.run(pending, null) };
  }

  /** A person releases a held call. Every hold finding must have been read and acknowledged. */
  async release(callId: string, human: HumanRelease): Promise<ToolReceipt> {
    const p = this.mustGet(callId);
    const missing = p.gate.findings.filter((f) => f.impact === "hold").map((f) => f.id).filter((id) => !human.acknowledged.includes(id));
    if (missing.length) {
      return this.seal({ ...p, type: "BLOCKED_ACTION_RECEIPT", status: "BLOCKED", release: human, result: null, executed: false,
        extra: [{ id: "HUMAN_RELEASE_MISSING", impact: "hold", message: "Waiting for a person's release." }],
        explanation: say("TOOL_RELEASE_NOT_ACKNOWLEDGED", { missing: missing.join(", ") }, `Not run yet. The release did not acknowledge: ${missing.join(", ")}.`) });
    }
    // Asked again at release time: an expired or revoked mandate, or a budget spent since, refuses.
    const fresh = checkToolCall({ mandate: this.mandate(), call: p.call, resolved: p.resolved, history: this.ledger.pastToolCalls(), now: this.clock(), target: p.target });
    this.pending.delete(callId);
    if (fresh.verdict === "fail") {
      const fails = fresh.findings.filter((f) => f.impact === "fail").map((f) => f.message).join(" ");
      return this.seal({ ...p, gate: fresh, type: "REFUSAL_RECEIPT", status: "NOT_AUTHORIZED", release: human, result: null, executed: false,
        extra: [{ id: "MANDATE_CHANGED_BEFORE_CAPTURE", impact: "fail", message: "Re-checked at release time, the mandate no longer allows this call." }],
        explanation: say("TOOL_MANDATE_CHANGED", { tool: p.call.tool }, `Not run. Between the request and the release, the mandate stopped allowing ${p.call.tool}: ${fails} PayPal was not asked.`) });
    }
    return this.run(p, human);
  }

  /** A person says no. PayPal is never asked. */
  decline(callId: string, by: string, reason: string): ToolReceipt {
    const p = this.mustGet(callId);
    this.pending.delete(callId);
    return this.seal({ ...p, type: "REFUSAL_RECEIPT", status: "REFUSED", release: null, result: null, executed: false,
      extra: [{ id: "DECLINED_BY_HUMAN", impact: "fail", message: reason }],
      explanation: say("TOOL_DECLINED", { by, reason, tool: p.call.tool }, `Not run. ${by} declined: ${reason}. PayPal was not asked to ${p.call.tool}.`) });
  }

  pendingList(): PendingToolCall[] {
    return [...this.pending.values()];
  }

  private mustGet(callId: string): PendingToolCall {
    const p = this.pending.get(callId);
    if (!p) throw new Error(`no held tool call ${callId}`);
    return p;
  }

  private async run(p: PendingToolCall, human: HumanRelease | null): Promise<ToolReceipt> {
    const already = this.ledger.toolExecuted(p.call.id);
    if (already) {
      return this.seal({ ...p, type: "BLOCKED_ACTION_RECEIPT", status: "BLOCKED", release: human, result: null, executed: false,
        extra: [{ id: "ALREADY_RAN", impact: "fail", message: "PayPal already ran this call." }],
        explanation: say("TOOL_ALREADY_RAN", { receipt: already.receipt_id }, `Not run again. PayPal already ran this call (receipt ${already.receipt_id}).`) });
    }
    // Only a call PayPal's own tools answered may say PayPal ran, refused or failed it.
    const real = this.provider === "paypal-sandbox-mcp";
    const paypal = real ? "PayPal" : "the simulated PayPal";
    const PayPal = real ? "PayPal" : "The simulated PayPal";
    let result: ToolResult;
    try {
      result = await this.tools.callTool(p.call.tool, p.call.args);
    } catch (e) {
      // The request may have reached PayPal before the answer was lost: never claim it did not run.
      return this.seal({ ...p, type: "PARTIAL_ACTION_RECEIPT", status: "PARTIAL", release: human, result: null, executed: false,
        extra: [{ id: "OUTCOME_UNKNOWN", impact: "hold", message: `${PayPal} did not answer: ${(e as Error).message}` }],
        explanation: say("TOOL_OUTCOME_UNKNOWN", { tool: p.call.tool }, `Unknown. ${PayPal} did not answer ${p.call.tool}; check ${paypal} before any retry.`) });
    }
    const failure = paypalFailure(result);
    if (failure === "no_answer") {
      // Sent by PayPal's tools, no answer from PayPal: it may have run, so it is unknown, like a lost answer.
      return this.seal({ ...p, type: "PARTIAL_ACTION_RECEIPT", status: "PARTIAL", release: human, result, executed: true,
        extra: [{ id: "OUTCOME_UNKNOWN", impact: "hold", message: `${PayPal}'s tools sent the call and ${paypal} did not answer: ${String(parsed(result)?.message ?? "").slice(0, 120)}` }],
        explanation: say("TOOL_OUTCOME_UNKNOWN", { tool: p.call.tool }, `Unknown. ${PayPal} did not answer ${p.call.tool}; check ${paypal} before any retry.`) });
    }
    if (failure === "not_sent") {
      const { code, message } = parsed(result);
      const params = { tool: p.call.tool, code: String(code), message: String(message ?? "").slice(0, 120) };
      return this.seal({ ...p, type: "BLOCKED_ACTION_RECEIPT", status: "FAILED", release: human, result, executed: true,
        extra: [{ id: "PAYPAL_TOOLS_NOT_SENT", impact: "fail", message: `${PayPal}'s tool server failed before sending the call to ${paypal}'s payments API.` }],
        explanation: say("TOOL_NOT_SENT_BY_PAYPAL_TOOLS", params, `Not done. ${PayPal}'s tool server failed before sending ${params.tool} to ${paypal}'s payments API (${params.code}: ${params.message}). A fault in the connection to ${paypal}'s tools, not a refusal by ${paypal}.`) });
    }
    const ok = failure === null;
    // A refund PayPal reports PENDING has not reached the customer yet: never counted as money moved.
    const pendingAtPayPal = ok && jsonOf(result)?.status === "PENDING";
    const moved = ok && !pendingAtPayPal && p.gate.klass === "money";
    return this.seal({ ...p, type: !ok ? "BLOCKED_ACTION_RECEIPT" : pendingAtPayPal ? "PARTIAL_ACTION_RECEIPT" : "ACTION_RECEIPT", status: !ok ? "FAILED" : pendingAtPayPal ? "PARTIAL" : "COMPLETED", release: human, result, executed: true, moved,
      extra: ok ? [] : [{ id: "PAYPAL_REFUSED", impact: "fail", message: `${real ? "PayPal" : "The simulated PayPal"} refused the call.`, ...(real ? {} : { params: { source: "simulated" } }) }],
      explanation: ok
        ? say("TOOL_DONE", { tool: p.call.tool, ...(human ? { by: human.by } : {}) }, `Done. The mandate allowed ${p.call.tool}${human ? `, ${human.by} released it` : ""}, and ${paypal} ran it.`)
        : say("TOOL_FAILED_AT_PAYPAL", { tool: p.call.tool }, `Not done. ${real ? "PayPal" : "The simulated PayPal"} refused ${p.call.tool}.`) });
  }

  private seal(a: { call: ToolCall; gate: ToolGateResult; resolved: Resolved; type: ToolReceipt["receipt_type"]; status: ToolReceipt["status"];
    release: HumanRelease | null; result: ToolResult | null; executed: boolean; moved?: boolean; extra?: Finding[]; explanation: Explanation }): ToolReceipt {
    const findings = [...a.gate.findings, ...(a.extra ?? [])];
    const moved = a.moved ?? false;
    const verdict: Verdict = a.status === "COMPLETED" ? "pass" : findings.some((f) => f.impact === "fail") ? "fail" : "hold";
    const json = jsonOf(a.result);
    const ids: Record<string, string> = {};
    if (json && typeof json === "object") for (const [k, v] of Object.entries(json)) if ((k === "id" || k.endsWith("_id")) && typeof v === "string") ids[k] = v;
    const text = a.result?.content?.find((c) => c.type === "text")?.text ?? "";
    const receipt: ToolReceipt = {
      schema: "anima.tool_receipt.v0",
      receipt_id: randomUUID(),
      receipt_type: a.type,
      status: a.status,
      created_at: this.clock().toISOString(),
      call: a.call,
      klass: a.gate.klass,
      mandate_id: this.mandate().id,
      resolved: a.resolved,
      verdict,
      line: lineFor(verdict),
      findings,
      release: a.release ? { by: a.release.by, at: a.release.at, acknowledged: a.release.acknowledged } : null,
      executed: a.executed,
      money_moved: moved,
      result: a.result ? { is_error: paypalFailed(a.result), ids, status: typeof json?.status === "string" ? json.status : null, text: text.slice(0, 400) } : null,
      explanation: a.explanation.text,
      explanation_code: a.explanation.code,
      explanation_params: a.explanation.params,
      provider: this.provider,
    };
    this.ledger.appendTool(receipt);
    return receipt;
  }
}
