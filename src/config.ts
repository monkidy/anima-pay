// Configuration from the environment, with an optional .env file next to the project.
// Secrets are never printed: redact() is what logs and receipts are allowed to show.

import { existsSync, readFileSync } from "node:fs";
import { SANDBOX_BASE } from "./paypal.ts";

export interface AnimaConfig {
  paypal: { clientId: string; clientSecret: string; baseUrl: string } | null;
  advisor: { kind: "openai-compatible" | "anthropic"; baseUrl: string; model: string; apiKey: string | null } | null;
  ledgerPath: string;
}

export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[line.slice(0, eq).trim()] = value;
  }
  return out;
}

export function loadConfig(env: Record<string, string | undefined> = process.env, dotEnvPath = ".env"): AnimaConfig {
  const file = existsSync(dotEnvPath) ? parseDotEnv(readFileSync(dotEnvPath, "utf8")) : {};
  const get = (k: string) => env[k] ?? file[k] ?? "";

  const clientId = get("PAYPAL_CLIENT_ID");
  const clientSecret = get("PAYPAL_CLIENT_SECRET");
  const baseUrl = get("PAYPAL_BASE_URL") || SANDBOX_BASE;
  if (new URL(baseUrl).hostname !== new URL(SANDBOX_BASE).hostname) {
    throw new Error(`PAYPAL_BASE_URL must be the sandbox (${SANDBOX_BASE}); got ${baseUrl}`);
  }

  const kind = get("ADVISOR_KIND") || "openai-compatible";
  if (kind !== "openai-compatible" && kind !== "anthropic") throw new Error(`ADVISOR_KIND must be openai-compatible or anthropic; got ${kind}`);
  const advisorUrl = get("ADVISOR_BASE_URL") || (kind === "anthropic" ? "https://api.anthropic.com" : "");
  const model = get("ADVISOR_MODEL");

  return {
    // ANIMA_SIMULATE=1 runs the simulator even when sandbox credentials exist (a second, simulated screen).
    paypal: clientId && clientSecret && get("ANIMA_SIMULATE") !== "1" ? { clientId, clientSecret, baseUrl } : null,
    advisor: advisorUrl && model ? { kind, baseUrl: advisorUrl, model, apiKey: get("ADVISOR_API_KEY") || null } : null,
    ledgerPath: get("ANIMA_LEDGER") || "ledger/receipts.jsonl",
  };
}

/**
 * What a hosted demo's visitors run on: scripted advice, unless the host opts in to its model with
 * ANIMA_HOSTED_MODEL exactly "1" (absent, "0", "true" or a typo all keep the script). PayPal is unchanged.
 */
export function hostedConfig(c: AnimaConfig, env: Record<string, string | undefined>): AnimaConfig {
  return env.ANIMA_HOSTED_MODEL === "1" ? c : { ...c, advisor: null };
}

/** What may be shown about a configuration: presence and endpoints, never secret values. */
export function redact(c: AnimaConfig): Record<string, string> {
  return {
    paypal: c.paypal ? `sandbox client ${c.paypal.clientId.slice(0, 4)}… at ${c.paypal.baseUrl}` : "not configured",
    advisor: c.advisor ? `${c.advisor.kind} ${c.advisor.model} at ${c.advisor.baseUrl}${c.advisor.apiKey ? " (key set)" : ""}` : "not configured",
    ledger: c.ledgerPath,
  };
}
