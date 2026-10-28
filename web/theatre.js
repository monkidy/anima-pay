// The decision theatre's facts, from one run: the rail of steps and the three locks. Two things the screen
// must not merge: whether the mandate allowed this payment (its own limits: payee, currency, amounts, dates,
// the proposal matching the invoice), and whether the gate refused it before PayPal for any reason (one of
// those limits, an invoice already paid, a duplicate, the council saying no). An invoice already paid is
// refused by the gate while the mandate stays valid.
"use strict";
(function (root) {
  const MANDATE_FINDINGS = ["MERCHANT_NOT_IN_MANDATE", "CURRENCY_NOT_IN_MANDATE", "OVER_PER_PAYMENT_LIMIT", "OVER_PERIOD_BUDGET", "MANDATE_EXPIRED", "MANDATE_REVOKED", "PROPOSAL_DOES_NOT_MATCH_INVOICE"];

  function theatreFacts(run, receipt, pending) {
    const c = run.council;
    const gateRefused = run.outcome === "refused";
    const mandateValid = !(receipt?.findings ?? []).some((f) => f.impact === "fail" && MANDATE_FINDINGS.includes(f.id));
    const verdict = receipt?.verdict ?? pending?.verdict ?? "hold";
    const payerOk = Boolean(receipt?.money_moved || pending?.payer_approved || pending?.stand_in || receipt?.evidence?.order_status === "APPROVED");
    const needsPerson = pending ? pending.human_release_required : /human_release/.test(receipt?.boundary?.approval ?? "") || verdict === "hold";
    const personOk = /human_release/.test(receipt?.boundary?.approval ?? "");
    // Each step as it stands: ok, waiting for someone, stopped there, or not needed.
    const rail = [
      ["propose", c.proposer.recommendation === "PAY" ? "ok" : "stop"],
      ["challenge", c.adversary.stance === "OBJECT" ? "stop" : "ok"],
      ["verify", c.verifier.stance === "OBJECT" ? "stop" : "ok"],
      ["mandate", mandateValid ? "ok" : "stop"],
      ["gate", gateRefused ? "stop" : "ok"],
      ["payer", gateRefused ? "skip" : payerOk ? "ok" : "wait"],
      ["seal", gateRefused || !needsPerson ? "skip" : personOk ? "ok" : "wait"],
      ["receipt", receipt ? "ok" : "wait"],
    ];
    const locks = {
      mandate: mandateValid ? "open" : "shut",
      payer: gateRefused ? "unasked" : payerOk ? "open" : "closed",
      person: !needsPerson ? "na" : personOk ? "open" : "closed",
    };
    return { verdict, gateRefused, mandateValid, rail, locks };
  }

  root.animaTheatre = { theatreFacts };
})(globalThis);
