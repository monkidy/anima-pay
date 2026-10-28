// ANIMA as an MCP server for real agents: PayPal's tools, labelled; reads pass; a held or refused call
// says so and is flagged as not done, so no agent can believe it reached PayPal.

import { test } from "node:test";
import assert from "node:assert/strict";
import { AnimaApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { handleMcp, originAllowed } from "../src/mcp-server.ts";

const rpc = (method: string, params: unknown = {}, id = 1) => ({ jsonrpc: "2.0", id, method, params });

test("an agent connects to ANIMA and sees PayPal's tools, each labelled with what the firewall will do", async () => {
  const a = new AnimaApp(loadConfig({}, "missing.env"));
  try {
    const init: any = await handleMcp(a, rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "0" } }));
    assert.match(init.result.serverInfo.name, /ANIMA/);
    // A notification carries no id and gets no answer (a default parameter would put one back: build it by hand).
    assert.equal(await handleMcp(a, { jsonrpc: "2.0", method: "notifications/initialized", params: {} }), null);
    const list: any = await handleMcp(a, rpc("tools/list"));
    assert.equal(list.result.tools.length, 46);
    const refund = list.result.tools.find((t: any) => t.name === "create_refund");
    assert.match(refund.description, /^\[ANIMA: moves money/);
    assert.ok(refund.inputSchema.properties.anima_reason);
  } finally { a.close(); }
});

test("a read passes; a refund is held and flagged as not done; an unknown tool is refused", async () => {
  const a = new AnimaApp(loadConfig({}, "missing.env"));
  try {
    const pay = await a.runScene(1);
    a.approveAsPayer(pay.pending_key!);
    const paid = await a.release(pay.pending_key!, "Studio Lumen");
    const read: any = await handleMcp(a, rpc("tools/call", { name: "get_order", arguments: { id: paid.evidence!.order_id } }));
    assert.notEqual(read.result.isError, true);
    const held: any = await handleMcp(a, rpc("tools/call", { name: "create_refund", arguments: { capture_id: paid.evidence!.capture_id, anima_reason: "customer asked" } }));
    assert.equal(held.result.isError, true);
    assert.match(held.result.content[0].text, /^Held by ANIMA/);
    const pending = a.state().tool_pending;
    assert.equal(pending.length, 1);
    assert.equal(pending[0].call.reason, "customer asked");
    assert.equal(pending[0].call.args.anima_reason, undefined);
    const refused: any = await handleMcp(a, rpc("tools/call", { name: "transfer_all_funds", arguments: {} }));
    assert.equal(refused.result.isError, true);
    assert.match(refused.result.content[0].text, /^Refused by ANIMA/);
  } finally { a.close(); }
});

test("bad requests get JSON-RPC errors, and only local pages may call", async () => {
  const a = new AnimaApp(loadConfig({}, "missing.env"));
  try {
    const bad: any = await handleMcp(a, { hello: "world" });
    assert.equal(bad.error.code, -32600);
    const unknown: any = await handleMcp(a, rpc("resources/list"));
    assert.equal(unknown.error.code, -32601);
    assert.equal(originAllowed(undefined, 5274), true);
    assert.equal(originAllowed("http://127.0.0.1:5274", 5274), true);
    assert.equal(originAllowed("https://evil.example", 5274), false);
  } finally { a.close(); }
});
