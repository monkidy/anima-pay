// Earned trust. The agent starts with no freedom over money: every payment needs a person.
// Merchant by merchant, a run of clean, sealed payments lets the agent PROPOSE a wider margin
// (pay alone up to some amount); only a person's sealed grant makes it real. The first anomaly
// voids every grant made before it, and the count starts again from zero.

import type { PaymentReceipt } from "./receipt.ts";

/** Findings that say something went wrong or looked wrong with this merchant. */
export const ANOMALIES = new Set([
  "PROPOSAL_DOES_NOT_MATCH_INVOICE", "INVOICE_ALREADY_PAID", "POSSIBLE_DUPLICATE", "MODEL_ADVISES_WAIT",
  "MODEL_ADVISES_REFUSE", "COUNCIL_DISSENT", "DECLINED_BY_HUMAN", "DOUBLE_CAPTURE", "OVER_PER_PAYMENT_LIMIT", "OVER_PERIOD_BUDGET",
]);

/** Clean payments needed, since the last grant or anomaly, before the agent may propose the next step. */
export const STREAK_FOR_STEP = 3;

export interface TrustGrant {
  merchant: string;
  auto_release_cents: number;
  by: string;
  at: string;
  /** The sealed receipts this grant rests on. */
  basis: string[];
}

export interface MerchantTrust {
  merchant: string;
  ceiling_cents: number;
  granted_cents: number;
  streak: number;
  last_anomaly: { at: string; receipt_id: string; reason: string } | null;
  proposal: { to_cents: number; basis: string[] } | null;
  /** Granted level over time, for the curve: every grant and every reset. */
  curve: { at: string; cents: number; why: "grant" | "reset" }[];
}

/** The ladder: 60 % of the ceiling the mandate allows, then all of it. */
export function steps(ceilingCents: number): number[] {
  return [Math.round(ceilingCents * 0.6), ceilingCents].filter((c, i, a) => c > 0 && a.indexOf(c) === i);
}

/**
 * Computes one merchant's trust from the sealed record alone: receipts, corrections (a correction
 * means the agent was wrong: an anomaly) and grants, in time order. Pure and replayable.
 */
export function merchantTrust(merchant: string, ceilingCents: number, receipts: readonly PaymentReceipt[], grants: readonly TrustGrant[]): MerchantTrust {
  type Ev = { at: string; kind: "paid" | "anomaly" | "grant"; id: string; reason?: string; cents?: number };
  const events: Ev[] = [];
  for (const r of receipts) {
    if (r.request?.merchant !== merchant) continue;
    const bad = r.findings.find((f) => ANOMALIES.has(f.id));
    if (bad) events.push({ at: r.created_at, kind: "anomaly", id: r.receipt_id, reason: bad.id });
    else if (r.money_moved) events.push({ at: r.created_at, kind: "paid", id: r.receipt_id });
    for (const c of r.corrections) events.push({ at: c.at, kind: "anomaly", id: r.receipt_id, reason: "CORRECTED" });
  }
  for (const g of grants) if (g.merchant === merchant) events.push({ at: g.at, kind: "grant", id: g.basis.join(","), cents: g.auto_release_cents });
  events.sort((a, b) => a.at.localeCompare(b.at));

  let granted = 0;
  let streak: string[] = [];
  let last_anomaly: MerchantTrust["last_anomaly"] = null;
  const curve: MerchantTrust["curve"] = [];
  for (const e of events) {
    if (e.kind === "paid") streak.push(e.id);
    if (e.kind === "anomaly") {
      if (granted > 0) curve.push({ at: e.at, cents: 0, why: "reset" });
      granted = 0;
      streak = [];
      last_anomaly = { at: e.at, receipt_id: e.id, reason: e.reason! };
    }
    if (e.kind === "grant") {
      granted = Math.min(e.cents!, ceilingCents);
      streak = [];
      curve.push({ at: e.at, cents: granted, why: "grant" });
    }
  }
  const next = steps(ceilingCents).find((c) => c > granted);
  const proposal = next !== undefined && streak.length >= STREAK_FOR_STEP ? { to_cents: next, basis: [...streak] } : null;
  return { merchant, ceiling_cents: ceilingCents, granted_cents: granted, streak: streak.length, last_anomaly, proposal, curve };
}
