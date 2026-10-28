// A minimal client for PayPal's remote MCP server (its agent tools), over the SSE transport the sandbox
// speaks (MCP protocol 2024-11-05): one long-lived event stream announces a session endpoint; JSON-RPC
// requests are POSTed there and the answers come back on the stream. Sandbox only, no dependencies.
// Observed 23/10/2026: the docs name /http, but the live endpoints are /sse (this transport) and /mcp.

export const MCP_SANDBOX_BASE = "https://mcp.sandbox.paypal.com";

export interface ToolInfo {
  name: string;
  description?: string;
  inputSchema?: { properties?: Record<string, unknown>; required?: string[] };
}

export interface ToolResult {
  content: { type: string; text?: string }[];
  isError?: boolean;
}

/** What the firewall needs from a source of tools: the real server, or a stand-in in tests. */
export interface ToolBackend {
  listTools(): Promise<ToolInfo[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<ToolResult>;
  close(): void;
}

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export class McpSseClient implements ToolBackend {
  private readonly base: string;
  private readonly token: () => Promise<string>;
  private readonly fetcher: Fetcher;
  private readonly timeoutMs: number;
  private session: Promise<string> | null = null;
  private abort: AbortController | null = null;
  private readonly waiting = new Map<number, (msg: any) => void>();
  private next = 0;

  constructor(opts: { token: () => Promise<string>; baseUrl?: string; fetcher?: Fetcher; timeoutMs?: number }) {
    const base = opts.baseUrl ?? MCP_SANDBOX_BASE;
    // Fail closed, like the REST client: never PayPal's live tools, whatever the configuration says.
    if (new URL(base).hostname !== new URL(MCP_SANDBOX_BASE).hostname) throw new Error(`refusing non-sandbox MCP endpoint: ${base}`);
    this.base = base;
    this.token = opts.token;
    this.fetcher = opts.fetcher ?? ((url, init) => fetch(url, init));
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  async listTools(): Promise<ToolInfo[]> {
    const res = await this.request("tools/list", {});
    return res.tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    return this.request("tools/call", { name, arguments: args });
  }

  close(): void {
    this.abort?.abort();
    this.session = null;
    this.abort = null;
  }

  /** Opens the stream and performs the handshake once; the session endpoint is reused until close(). */
  private connect(): Promise<string> {
    if (this.session) return this.session;
    this.session = (async () => {
      this.abort = new AbortController();
      const res = await this.fetcher(`${this.base}/sse`, { headers: { Authorization: `Bearer ${await this.token()}`, Accept: "text/event-stream" }, signal: this.abort.signal });
      if (res.status !== 200 || !res.body) throw new Error(`PayPal MCP stream refused: HTTP ${res.status}`);
      const endpoint = await this.read(res.body);
      const init = await this.send(endpoint, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "anima", version: "0.1" } });
      if (!init.serverInfo) throw new Error("PayPal MCP handshake returned no server");
      await this.post(endpoint, { jsonrpc: "2.0", method: "notifications/initialized", params: {} });
      return endpoint;
    })();
    this.session.catch(() => this.close());
    return this.session;
  }

  /** Reads the stream in the background; resolves with the session endpoint, then routes answers by id. */
  private read(body: ReadableStream<Uint8Array>): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let announced = false;
      (async () => {
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
            let cut: number;
            while ((cut = buffer.indexOf("\n\n")) >= 0) {
              const block = buffer.slice(0, cut);
              buffer = buffer.slice(cut + 2);
              const event = /^event: ?(.*)$/m.exec(block)?.[1]?.trim() ?? "message";
              const data = block.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).replace(/^ /, "")).join("\n");
              if (event === "endpoint" && !announced) {
                announced = true;
                resolve(new URL(data, this.base).toString());
              } else if (data) {
                let msg: any;
                try { msg = JSON.parse(data); } catch { continue; }
                this.waiting.get(msg.id)?.(msg);
              }
            }
          }
        } catch { /* closed or aborted */ }
        if (!announced) reject(new Error("PayPal MCP stream ended before announcing a session"));
        this.session = null;
      })();
    });
  }

  private async request(method: string, params: unknown): Promise<any> {
    return this.send(await this.connect(), method, params);
  }

  private async send(endpoint: string, method: string, params: unknown): Promise<any> {
    const id = ++this.next;
    const answer = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => { this.waiting.delete(id); reject(new Error(`PayPal MCP ${method}: no answer in ${this.timeoutMs} ms`)); }, this.timeoutMs);
      this.waiting.set(id, (msg) => { clearTimeout(timer); this.waiting.delete(id); resolve(msg); });
    });
    try {
      await this.post(endpoint, { jsonrpc: "2.0", id, method, params });
    } catch (e) {
      this.waiting.delete(id);
      throw e;
    }
    const msg = await answer;
    if (msg.error) throw new Error(`PayPal MCP ${method}: ${msg.error.message ?? JSON.stringify(msg.error)}`);
    return msg.result;
  }

  private async post(endpoint: string, body: unknown): Promise<void> {
    const res = await this.fetcher(endpoint, { method: "POST", headers: { Authorization: `Bearer ${await this.token()}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.status >= 300) throw new Error(`PayPal MCP POST refused: HTTP ${res.status}`);
  }
}
