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
