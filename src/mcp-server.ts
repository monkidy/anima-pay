// ANIMA as an MCP server: a real agent (Claude Desktop, any MCP client) connects to ANIMA instead of to
// PayPal's tools. It sees PayPal's own tools, each labelled with what the firewall will do, and every
// call goes through the tool desk: reads pass, writes meet the mandate and a person, and a call that did
// not run is never reported as done. Streamable HTTP with JSON answers; the server listens locally.

import type { AnimaApp } from "./app.ts";

export const MCP_PROTOCOL = "2025-03-26";

const LABEL: Record<string, string> = {
  read: "passes (a read)",
  money: "moves money: checked against the mandate, then held for a person above what the agent has earned",
  outreach: "reaches a customer: only people the mandate names, held for a person above the earned threshold",
  destructive: "deletes or cancels: always held for a person",
  setup: "changes records: allowed by the mandate, sealed in a receipt",
};

const ok = (id: unknown, result: unknown) => ({ jsonrpc: "2.0", id, result });
const fail = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });
const text = (t: string, isError: boolean) => ({ content: [{ type: "text", text: t }], isError });

/** Answers one JSON-RPC message; null for a notification, which gets no answer. */
export async function handleMcp(app: AnimaApp, msg: any, agent = "mcp-client"): Promise<object | null> {
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return fail(msg?.id ?? null, -32600, "invalid request");
  if (msg.id === undefined || msg.id === null) return null;
  try {
    switch (msg.method) {
      case "initialize":
        return ok(msg.id, {
          protocolVersion: typeof msg.params?.protocolVersion === "string" ? msg.params.protocolVersion : MCP_PROTOCOL,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "ANIMA: the locks in front of PayPal's agent tools", version: "0.1" },
          instructions: "These are PayPal's own tools, behind ANIMA. Reads pass. Anything that moves money, reaches a customer or deletes something is checked against a written mandate and may be held for a person; a held or refused call did not reach PayPal. Give your reason in anima_reason: it is kept in the receipt.",
        });
      case "ping":
        return ok(msg.id, {});
      case "tools/list": {
        const tools = (await app.toolList()).map((t) => ({
          name: t.name,
          description: `[ANIMA: ${t.anima_class ? LABEL[t.anima_class] : "unknown to the firewall: refused"}] ${(t.description ?? "").trim()}`.trim(),
          inputSchema: {
            ...(t.inputSchema ?? { type: "object" }),
            properties: { ...(t.inputSchema?.properties ?? {}), anima_reason: { type: "string", description: "Why you make this call. Kept in ANIMA's sealed receipt; never sent to PayPal." } },
          },
        }));
        return ok(msg.id, { tools });
      }
      case "tools/call": {
        const name = msg.params?.name;
        if (typeof name !== "string") return fail(msg.id, -32602, "tools/call needs a tool name");
        const { anima_reason, ...args } = (msg.params?.arguments ?? {}) as Record<string, unknown>;
        const out = await app.toolRequest(name, args, typeof anima_reason === "string" ? anima_reason.slice(0, 500) : "(no reason given)", agent);
        if (out.kind === "read") return ok(msg.id, out.result);
        if (out.kind === "held") {
          const why = out.pending.gate.findings.filter((f) => f.impact !== "info").map((f) => f.message).join(" ") || "A person must release it.";
          return ok(msg.id, text(`Held by ANIMA for a person; nothing was sent to PayPal. ${why} Call ${out.pending.call.id} waits in ANIMA for the account owner.`, true));
        }
        const r = out.receipt;
        if (out.kind === "refused") {
          return ok(msg.id, text(`Refused by ANIMA; nothing was sent to PayPal. ${r.explanation} Receipt ${r.receipt_id}.`, true));
        }
        return ok(msg.id, text(`${r.explanation} Receipt ${r.receipt_id}.${r.result?.text ? ` PayPal answered: ${r.result.text}` : ""}`, r.status !== "COMPLETED"));
      }
      default:
        return fail(msg.id, -32601, `method not found: ${msg.method}`);
    }
  } catch (e) {
    return fail(msg.id, -32603, (e as Error).message);
  }
}

/** DNS-rebinding guard from the MCP transport spec: a browser page from another origin may not call. */
export function originAllowed(origin: string | undefined, port: number): boolean {
  if (!origin) return true;
  return origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
}
