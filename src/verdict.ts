// Recycled from ace-receipts 0.2.0 (Apache-2.0, Hichem Benali, June 2026): the verdict
// vocabulary, the one-line phrases and the Gate Wizard, applied to money instead of diffs.

export type Verdict = "pass" | "hold" | "fail";

export const SLOGAN = "Agents can spend. Make them bring receipts.";
export const CATCHPHRASE = "No receipt, no payment.";

/** One memorable line per verdict. Exactly one. */
export const PHRASES: Record<Verdict, string> = {
  pass: "Proof opens the gate.",
  hold: "Not yet. Bring receipts.",
  fail: "Vibes shall not pass.",
};

export const GATE_WIZARD: readonly string[] = [
  "          ✦",
  "      /_\\ │",
  "     (•_•)│",
  "      /|_ │",
  "      / \\ │",
  "   ════╪════",
  "         │",
];

export interface Finding {
  id: string;
  impact: "fail" | "hold" | "info";
  /** English text; params let a screen say the same thing in another language. */
  message: string;
  params?: Record<string, string | number>;
}

/** fail beats hold beats pass: one failing finding closes the gate. */
export function verdictOf(findings: readonly Finding[]): Verdict {
  if (findings.some((f) => f.impact === "fail")) return "fail";
  if (findings.some((f) => f.impact === "hold")) return "hold";
  return "pass";
}
