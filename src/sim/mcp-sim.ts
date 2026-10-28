// In-memory stand-in for PayPal's remote MCP server, speaking the same SSE transport: GET /sse opens a
// stream that announces a session endpoint, and JSON-RPC POSTed there is answered on the stream. For
// tests and for the demo without sandbox credentials (which then says so). Each call is recorded.

import { TOOL_CLASSES } from "../guard.ts";
import type { ToolResult } from "../mcp.ts";

type Handler = (args: Record<string, unknown>) => unknown;

export class McpSimulator {
  calls: { name: string; args: Record<string, unknown> }[] = [];
  private readonly streams = new Set<ReadableStreamDefaultController<Uint8Array>>();
  private readonly handlers = new Map<string, Handler>();
  private readonly encoder = new TextEncoder();
  private seq = 0;

  constructor() {
    this.handlers.set("get_order", (a) => ({ id: a.id, status: "COMPLETED", purchase_units: [{ amount: { currency_code: "EUR", value: "29.00" } }] }));
    this.handlers.set("create_refund", (a) => ({ id: this.id("REFUND"), status: "COMPLETED", capture_id: a.capture_id, amount: a.amount ?? { currency_code: "EUR", value: "29.00" } }));
    this.handlers.set("list_transactions", () => ({ transaction_details: [{ transaction_info: { transaction_id: "SIMTXN000001", transaction_amount: { currency_code: "EUR", value: "29.00" }, transaction_status: "S" } }], total_items: 1, total_pages: 1 }));
    this.handlers.set("get_dispute", (a) => ({ dispute_id: a.dispute_id, dispute_amount: { currency_code: "EUR", value: "40.00" }, status: "OPEN" }));
    this.handlers.set("get_invoice", (a) => ({ id: a.invoice_id, amount: { currency_code: "EUR", value: "12.00" }, primary_recipients: [{ billing_info: { email_address: "client@shop.example" } }] }));
  }

  /** Answer a tool with a fixed result, or override one of the defaults. */
  on(name: string, handler: Handler): void {
    this.handlers.set(name, handler);
  }

  count(name: string): number {
    return this.calls.filter((c) => c.name === name).length;
  }

  get fetcher() {
    return async (url: string, init?: RequestInit): Promise<Response> => this.handle(url, init);
  }

  private id(prefix: string): string {
    this.seq += 1;
    return `${prefix}${String(this.seq).padStart(12, "0")}`;
  }

  private push(event: string, data: string): void {
    for (const c of this.streams) c.enqueue(this.encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
  }

  private handle(url: string, init?: RequestInit): Response {
    const u = new URL(url);
    if (!String((init?.headers as Record<string, string> | undefined)?.Authorization ?? "").startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "invalid_token" }), { status: 401 });
    }
    if ((init?.method ?? "GET") === "GET" && u.pathname === "/sse") {
      let ctl: ReadableStreamDefaultController<Uint8Array>;
      const body = new ReadableStream<Uint8Array>({
        start: (c) => { ctl = c; this.streams.add(c); c.enqueue(this.encoder.encode("event: endpoint\ndata: /sse/message?sessionId=sim\n\n")); },
        cancel: () => { this.streams.delete(ctl); },
      });
      init?.signal?.addEventListener("abort", () => { this.streams.delete(ctl); try { ctl.close(); } catch { /* already closed */ } });
      return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
    }
    if (init?.method === "POST" && u.pathname === "/sse/message") {
      const msg = JSON.parse(String(init.body));
      if (msg.id !== undefined) queueMicrotask(() => this.push("message", JSON.stringify({ jsonrpc: "2.0", id: msg.id, ...this.answer(msg.method, msg.params) })));
      return new Response("Accepted", { status: 202 });
    }
    return new Response("Not Found", { status: 404 });
  }

  private answer(method: string, params: any): { result?: unknown; error?: unknown } {
    if (method === "initialize") return { result: { protocolVersion: "2024-11-05", serverInfo: { name: "PayPal MCP Agent (simulated)", version: "sim" }, capabilities: { tools: {} } } };
    if (method === "tools/list") return { result: { tools: Object.keys(TOOL_CLASSES).map((name) => ({ name, description: `${name} (simulated)`, inputSchema: { type: "object", properties: {} } })) } };
    if (method === "tools/call") {
      const { name, arguments: args = {} } = params ?? {};
      this.calls.push({ name, args });
      const handler = this.handlers.get(name);
      if (!handler) return { result: { content: [{ type: "text", text: `simulated ${name}: no canned answer` }], isError: true } };
      // Like PayPal: a tool that fails answers with an error result, not a broken connection.
      try {
        const result: ToolResult = { content: [{ type: "text", text: JSON.stringify(handler(args)) }] };
        return { result };
      } catch (e) {
        return { result: { content: [{ type: "text", text: `simulated ${name} failed: ${(e as Error).message}` }], isError: true } };
      }
    }
    return { error: { code: -32601, message: `method not found: ${method}` } };
  }
}
