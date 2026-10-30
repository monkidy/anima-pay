// "Don't trust us, break it": two proofs a visitor runs on their own session.
//
// 1. Break the ledger: GET /api/prove/ledgers hands over the session's sealed ledger and the chaos
//    lab's, each with its public key and signed head; the page verifies them in the browser.
// 2. Chaos PayPal: the visitor picks how PayPal's tools fail, releases a refund an agent asked for, and
//    sees what ANIMA seals. The tools are always the in-memory stand-in (McpSimulator), never PayPal: the
//    lab has its own simulated tools, its own tool desk and its own ledger, so none of its receipts can
//    count as money that left on the session's desk, whatever that desk is connected to.
//
// The failures are PayPal's agent toolkit's own error codes (see paypalFailure in tooldesk.ts); the
// decisions and the seals are the tool desk's, unchanged.

import type { AnimaApp } from "./app.ts";
import { Ledger } from "./ledger.ts";
import { McpSseClient } from "./mcp.ts";
import type { ToolReceipt } from "./receipt.ts";
import { TOOL_MANDATE } from "./scenes.ts";
import { McpSimulator } from "./sim/mcp-sim.ts";
import { ToolDesk, paypalFacts, type PendingToolCall } from "./tooldesk.ts";
import { randomUUID } from "node:crypto";

export const FAULTS = ["not_sent", "no_answer", "refused", "ok"] as const;
export type Fault = (typeof FAULTS)[number];

/** Asks one lab takes before it must be reset: well inside the mandate's period budget, and bounded memory. */
export const MAX_ASKS = 12;
const REFUND = { currency_code: "EUR", value: "12.50" };

/** What the simulated PayPal answers create_refund with, for each fault, in the shape PayPal's tools use. */
const ANSWERS: Record<Fault, (args: Record<string, unknown>, n: number) => unknown> = {
  // What PayPal's hosted tool server answered every call with from 29/10 (paypal/agent-toolkit#119).
  not_sent: () => ({ ok: false, code: "PAYPAL_API_SETUP_ERROR", message: "Unsupported cache mode: default" }),
  no_answer: () => ({ ok: false, code: "PAYPAL_API_NO_RESPONSE", message: "The request was sent to PayPal and no response came back" }),
  refused: () => ({ ok: false, status: 403, code: "PERMISSION_DENIED", message: "You do not have permission to access or perform operations on this resource." }),
  ok: (a, n) => ({ id: `SIMREFUND${String(n).padStart(9, "0")}`, status: "COMPLETED", capture_id: a.capture_id, amount: a.amount }),
};

export interface HeldView {
  call_id: string;
  tool: string;
  args: Record<string, unknown>;
  reason: string;
  resolved: PendingToolCall["resolved"];
  holds: string[];
}

export class ChaosLab {
  private readonly sim = new McpSimulator();
  private readonly tools = new McpSseClient({ token: async () => "simulated", fetcher: this.sim.fetcher });
  readonly ledger = new Ledger(null);
  private readonly desk = new ToolDesk({
    tools: this.tools, ledger: this.ledger, mandate: () => TOOL_MANDATE, provider: "paypal-sandbox-mcp-simulator",
    // The capture the refund would return, as the simulated PayPal holds it.
    resolver: paypalFacts({ capture: async () => ({ amount: { currency_code: "EUR", value: "29.00" } }) }),
  });
  private asks = 0;
  /** One release at a time: the fault is the simulator's answer while that release runs. */
  private queue: Promise<unknown> = Promise.resolve();

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** An agent asks to refund a simulated capture; the mandate holds every write for a person. */
  ask(): Promise<HeldView> {
    return this.serial(async () => {
      if (this.asks >= MAX_ASKS) throw new Error(`this chaos lab has taken its ${MAX_ASKS} refunds; reset it to start again`);
      this.asks += 1;
      const call = { id: `call-${randomUUID()}`, tool: "create_refund", args: { capture_id: `SIMCAPTURE${String(this.asks).padStart(6, "0")}`, amount: REFUND },
        reason: "A customer asked for a refund of a 12.50 EUR overcharge.", agent: "chaos lab agent", requested_at: new Date().toISOString() };
      try {
        const out = await this.desk.request(call);
        if (out.kind !== "held") throw new Error(`the agent's refund was not held (${out.kind})`);
        return view(out.pending);
      } finally { this.tools.close(); }
    });
  }

  /** The visitor releases the held refund while the simulated PayPal answers with the chosen fault. */
  release(callId: string, fault: Fault, by: string): Promise<ToolReceipt> {
    if (!FAULTS.includes(fault)) return Promise.reject(new Error(`unknown fault ${fault}; one of ${FAULTS.join(", ")}`));
    return this.serial(async () => {
      const held = this.desk.pendingList().find((p) => p.call.id === callId);
      if (!held) throw new Error(`no held refund ${callId}`);
      const n = this.asks;
      this.sim.on("create_refund", (a) => ANSWERS[fault](a, n));
      try {
        return await this.desk.release(callId, { by, at: new Date().toISOString(), acknowledged: view(held).holds });
      } finally { this.tools.close(); }
    });
  }

  get asksLeft(): number {
    return MAX_ASKS - this.asks;
  }

  held(): HeldView[] {
    return this.desk.pendingList().map(view);
  }

  sealed() {
    return { entries: this.ledger.sealedEntries(), publicKeyPem: this.ledger.publicKeyPem, head: this.ledger.head() };
  }

  /** Closes the lab once whatever release is running has sealed its receipt. */
  close(): Promise<void> {
    return this.serial(async () => { this.tools.close(); });
  }
}

function view(p: PendingToolCall): HeldView {
  return { call_id: p.call.id, tool: p.call.tool, args: p.call.args, reason: p.call.reason, resolved: p.resolved,
    holds: p.gate.findings.filter((f) => f.impact === "hold").map((f) => f.id) };
}

/** One lab per desk: a hosted visitor's lives and dies with their session's desk. */
const labs = new WeakMap<AnimaApp, ChaosLab>();
/** Each reset makes a new signing key: a session gets this many, like its scene budget bounds its runs. */
export const MAX_RESETS = 20;
const resets = new WeakMap<AnimaApp, number>();
function labOf(app: AnimaApp): ChaosLab {
  let lab = labs.get(app);
  if (!lab) { lab = new ChaosLab(); labs.set(app, lab); }
  return lab;
}

/** The /api/prove/* routes, or null when the path is not one of them. `by` is the person the server names. */
export async function proveApi(app: AnimaApp, method: string, path: string, body: any, by: string): Promise<[number, unknown] | null> {
  if (!path.startsWith("/api/prove/")) return null;
  const lab = labOf(app);
  const chaos = (l: ChaosLab) => ({ held: l.held(), receipts: l.ledger.toolReceipts().reverse(), asks_left: l.asksLeft });
  if (method === "GET" && path === "/api/prove/ledgers") return [200, { session: app.sealedLedger(), chaos: lab.sealed() }];
  if (method === "GET" && path === "/api/prove/chaos") return [200, chaos(lab)];
  if (method !== "POST") return [404, { error: "not found" }];
  if (path === "/api/prove/chaos/ask") return [200, { asked: await lab.ask(), ...chaos(lab) }];
  if (path === "/api/prove/chaos/release") {
    const receipt = await lab.release(String(body.call_id), body.fault as Fault, by);
    return [200, { receipt, ...chaos(lab) }];
  }
  if (path === "/api/prove/chaos/reset") {
    const n = resets.get(app) ?? 0;
    if (n >= MAX_RESETS) return [429, { error: `this session has reset its chaos lab ${MAX_RESETS} times` }];
    resets.set(app, n + 1);
    await lab.close();
    const fresh = new ChaosLab();
    labs.set(app, fresh);
    return [200, chaos(fresh)];
  }
  return [404, { error: "not found" }];
}
