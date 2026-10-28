// The proof lens borrows the Control Room's "what happened / money moved / evidence?" habit.
// No score, payment authorization, currency conversion, or provider truth is inferred here.
// Inputs are the same signed payment/tool receipts already returned by /api/state.
(function(root) {
  "use strict";
  const entries = (payments = [], tools = []) => [
    ...payments.map((r) => ({
      id: r.receipt_id,
      moved: r.money_moved === true,
      corrected: Array.isArray(r.corrections) && r.corrections.length > 0,
    })),
    ...tools.map((r) => ({ id: r.receipt_id, moved: r.money_moved === true, corrected: false })),
  ];
  const counts = (all) => ({
    total: all.length,
    moved: all.filter((r) => r.moved).length,
    notMoved: all.filter((r) => !r.moved).length,
    corrected: all.filter((r) => r.corrected).length,
  });
  const matches = (entry, scope) => {
    switch (scope) {
      case "moved": return entry.moved;
      case "notMoved": return !entry.moved;
      case "corrected": return entry.corrected;
      default: return scope === "all";
    }
  };
  const select = (rows, scope) => rows.filter((r) => matches(r.proof, scope));
  root.animaProofLens = { entries, counts, matches, select };
})(globalThis);
