// Earned trust. The agent starts with no freedom over money: every payment needs a person.
// Merchant by merchant, a run of clean, sealed payments lets the agent PROPOSE a wider margin
// (pay alone up to some amount); only a person's sealed grant makes it real. The first anomaly
// voids every grant made before it, and the count starts again from zero.

import type { Ledger } from "./ledger.ts";

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
 * Reconstruct one merchant's autonomy from the SEALED APPEND ORDER, not timestamps.
 * Timestamp ties and clock drift must never allow an older grant to erase a later
 * anomaly. Ledger entries are already in the signed sequence that produced them.
 * This is a read-only projection: all authorization still lives elsewhere.
 */
export function merchantTrust(
  merchant: string, ceilingCents: number,
  entries: ReturnType<Ledger["sealedEntries"]>,
): MerchantTrust {
  let granted = 0;
  let streak: string[] = [];
  let last_anomaly: MerchantTrust["last_anomaly"] = null;
  const curve: MerchantTrust["curve"] = [];
  const seenReceiptIds = new Set<string>();

  function reset(at: string, id: string, reason: string): void {
    if (granted > 0) curve.push({ at, cents: 0, why: "reset" });
    granted = 0;
    streak = [];
    last_anomaly = { at, receipt_id: id, reason };
  }

  for (const entry of entries) {
    // All four entry types share one cryptographically sequenced append-only log.
    // A correction can be applied only after its referenced receipt exists.
    if (entry.schema === "anima.payment_receipt.v0") {
      if (entry.request.merchant !== merchant) continue;
      seenReceiptIds.add(entry.receipt_id);
      const bad = entry.findings.find(f => ANOMALIES.has(f.id));
      if (bad) reset(entry.created_at, entry.receipt_id, bad.id);
      else if (entry.money_moved) streak.push(entry.receipt_id);
    } else if (entry.schema === "anima.correction.v0") {
      if (seenReceiptIds.has(entry.receipt_id)) reset(entry.at, entry.receipt_id, "CORRECTED");
    } else if (entry.schema === "anima.trust_grant.v0" && entry.merchant === merchant) {
      granted = Math.min(entry.auto_release_cents, ceilingCents);
      streak = [];
      curve.push({ at: entry.at, cents: granted, why: "grant" });
    }
  }
  const next = steps(ceilingCents).find(c => c > granted);
  const proposal = next !== undefined && streak.length >= STREAK_FOR_STEP
    ? { to_cents: next, basis: [...streak] } : null;
  return { merchant, ceiling_cents: ceilingCents, granted_cents: granted,
    streak: streak.length, last_anomaly, proposal, curve };
}
