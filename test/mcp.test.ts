// The MCP client for PayPal's agent tools, against the SSE stand-in: handshake, tools, calls, and the
// refusals that keep it on the sandbox.

import { test } from "node:test";
import assert from "node:assert/strict";
import { McpSseClient } from "../src/mcp.ts";
import { McpSimulator } from "../src/sim/mcp-sim.ts";

const token = async () => "test-token";

test("the client lists PayPal's tools and calls one over the SSE transport", async () => {
  const sim = new McpSimulator();
  const client = new McpSseClient({ token, fetcher: sim.fetcher, timeoutMs: 2_000 });
  try {
    const tools = await client.listTools();
    assert.equal(tools.length, 46);
    const res = await client.callTool("get_order", { id: "ORDER1" });
    assert.equal(res.isError, undefined);
    assert.equal(JSON.parse(res.content[0].text!).status, "COMPLETED");
    assert.deepEqual(sim.calls, [{ name: "get_order", args: { id: "ORDER1" } }]);
  } finally {
    client.close();
  }
});

test("the client refuses PayPal's live tools, whatever the configuration says", () => {
  assert.throws(() => new McpSseClient({ token, baseUrl: "https://mcp.paypal.com" }), /non-sandbox/);
});

test("a refused stream is an error, not an empty tool list", async () => {
  const sim = new McpSimulator();
  const client = new McpSseClient({ token: async () => "", fetcher: (url, init) => sim.fetcher(url, { ...init, headers: {} }), timeoutMs: 1_000 });
  await assert.rejects(() => client.listTools(), /HTTP 401/);
  client.close();
});

test("a refused POST leaves no timer behind: no unobserved rejection can stop the server later", async () => {
  // PayPal's tool server announces a session, then refuses every POST (as on 29/10). Before the fix the
  // pending answer's timer still fired after the caller had its error, and its rejection, observed by
  // nobody, stopped Node.
  const enc = new TextEncoder();
  const fetcher = async (url: string) => url.endsWith("/sse")
    ? new Response(new ReadableStream({ start(c) { c.enqueue(enc.encode("event: endpoint\ndata: /messages?s=1\n\n")); } }), { status: 200 })
    : new Response("boom", { status: 503 });
  const unobserved: unknown[] = [];
  const watch = (e: unknown) => unobserved.push(e);
  process.on("unhandledRejection", watch);
  const client = new McpSseClient({ token, fetcher, timeoutMs: 50 });
  try {
    await assert.rejects(() => client.listTools(), /HTTP 503/);
    await new Promise((r) => setTimeout(r, 200));
    assert.deepEqual(unobserved, []);
  } finally {
    process.off("unhandledRejection", watch);
    client.close();
  }
});

test("an answer that never comes is the caller's error, even while the POST is still on its way", async () => {
  const enc = new TextEncoder();
  const fetcher = async (url: string) => url.endsWith("/sse")
    ? new Response(new ReadableStream({ start(c) { c.enqueue(enc.encode("event: endpoint\ndata: /messages?s=1\n\n")); } }), { status: 200 })
    : new Promise<Response>((r) => setTimeout(() => r(new Response("", { status: 202 })), 150));
  const unobserved: unknown[] = [];
  const watch = (e: unknown) => unobserved.push(e);
  process.on("unhandledRejection", watch);
  const client = new McpSseClient({ token, fetcher, timeoutMs: 50 });
  try {
    await assert.rejects(() => client.listTools(), /no answer in 50 ms/);
    assert.deepEqual(unobserved, []);
  } finally {
    process.off("unhandledRejection", watch);
    client.close();
  }
});
