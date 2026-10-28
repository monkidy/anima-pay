// Scene 7: what finally happened to each call the agent made to PayPal's tools. A step records how the
// call ran when the agent asked; a person may release or decline a held call afterwards, and the receipt
// sealed then is the truth. The rows and the totals both read this one view, so they cannot disagree.
"use strict";
(function (root) {
  /** A receipt's explanation code says what became of a call once a person decided. */
  const FROM_CODE = {
    TOOL_DONE: "done", TOOL_FAILED_AT_PAYPAL: "paypal_refused", TOOL_OUTCOME_UNKNOWN: "unknown",
    TOOL_DECLINED: "refused", TOOL_MANDATE_CHANGED: "refused", TOOL_REFUSED: "refused", TOOL_ALREADY_RAN: "refused",
  };
  /** Which total each final kind counts in: sent to PayPal, held for a person, refused before PayPal, or unclear. */
  const BUCKET = { read: "sent", done: "sent", paypal_refused: "sent", held: "held", refused: "refused", unknown: "unclear", error: "unclear" };

  function effectiveKind(step, receipt) {
    if (step.kind === "read" || step.kind === "error") return step.kind;
    if (receipt) return FROM_CODE[receipt.explanation_code] ?? (receipt.executed ? "done" : step.kind);
    return step.kind;
  }

  /** One row per call, with the receipt that says what happened to it (found by receipt id, or by call id once a
   *  held call was decided) and its final kind. A release that did not acknowledge every hold seals a receipt but
   *  leaves the call waiting; a decision ends the call, so a call has at most one deciding receipt. That one is the
   *  truth whatever order the receipts arrive in (the API lists them newest first). */
  function firewallView(run, toolReceipts, toolPending) {
    const rows = run.steps.map((step) => {
      const mine = toolReceipts.filter((r) => (step.receipt_id && r.receipt_id === step.receipt_id) || r.call.id === step.call.id);
      const receipt = mine.find((r) => r.explanation_code !== "TOOL_RELEASE_NOT_ACKNOWLEDGED") ?? mine[0] ?? null;
      const pending = toolPending.find((p) => p.call.id === step.call.id) ?? null;
      return { step, receipt, pending, kind: effectiveKind(step, receipt) };
    });
    const totals = { sent: 0, held: 0, refused: 0, unclear: 0 };
    for (const row of rows) totals[BUCKET[row.kind]] += 1;
    return { rows, totals };
  }

  /** Where a call's facts and answers came from: PayPal's sandbox, or the simulator that stands in for it when
   *  the desk has no PayPal credentials. A receipt names its provider; a call still waiting has none, so the
   *  desk's mode decides. Only a real PayPal lookup may be called PayPal. */
  function factsSource(record, mode) {
    if (record?.provider) return record.provider === "paypal-sandbox-mcp" ? "paypal" : "simulated";
    return mode?.paypal === "paypal-sandbox" ? "paypal" : "simulated";
  }

  root.animaFirewall = { effectiveKind, firewallView, factsSource };
})(globalThis);
