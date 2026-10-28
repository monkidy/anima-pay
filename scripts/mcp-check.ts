// Real check against PayPal's sandbox MCP server (its agent tools), with the credentials from .env:
// every tool PayPal lists must have a class in the firewall, and every class the firewall knows must
// still be listed; then one read goes through the firewall to PayPal and back. Nothing is written.
//   node scripts/mcp-check.ts <sandbox-order-id>   (an order of your own sandbox app, e.g. from npm run smoke)
// Exit codes: 0 pass, 2 not configured, 1 failure.

import { loadConfig } from "../src/config.ts";
import { PayPalSandbox } from "../src/paypal.ts";
import { McpSseClient } from "../src/mcp.ts";
import { TOOL_CLASSES, checkToolCall, type ToolMandate } from "../src/guard.ts";

const config = loadConfig();
if (!config.paypal) {
  console.log("NOT_CONFIGURED: set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET (sandbox app) in .env");
  process.exit(2);
}
const order = process.argv[2];
if (!order) {
  console.log("NOT_CONFIGURED: give an order id of your sandbox app (npm run mcp-check -- <order-id>)");
  process.exit(2);
}
const paypal = new PayPalSandbox(config.paypal);
const client = new McpSseClient({ token: () => paypal.bearerToken() });
const mandate: ToolMandate = {
  id: "mcp-check", owner: "check", purpose: "read-only check", allowed_classes: ["read"], currency: "EUR",
  max_per_call_cents: 0, max_per_period_cents: 0, period_days: 30, human_release_above_cents: 0, recipients: [],
  expires_at: "2099-01-01T00:00:00Z", revoked: false,
};
try {
  const listed = (await client.listTools()).map((t) => t.name);
  const unknown = listed.filter((n) => !Object.hasOwn(TOOL_CLASSES, n));
  const gone = Object.keys(TOOL_CLASSES).filter((n) => !listed.includes(n));
  const gate = checkToolCall({ mandate, call: { id: "c1", tool: "get_order", args: { id: order }, reason: "check", agent: "mcp-check", requested_at: new Date().toISOString() }, resolved: {}, history: [], now: new Date() });
  const res = gate.verdict === "pass" ? await client.callTool("get_order", { id: order }) : null;
  let status = "";
  try { status = JSON.parse(res?.content?.[0]?.text ?? "{}").status ?? ""; } catch { status = (res?.content?.[0]?.text ?? "").slice(0, 80); }
  const refused = checkToolCall({ mandate, call: { id: "c2", tool: "create_refund", args: { capture_id: "X" }, reason: "check", agent: "mcp-check", requested_at: new Date().toISOString() }, resolved: {}, history: [], now: new Date() });
  const checks = {
    tools_listed: listed.length > 0,
    every_listed_tool_classified: unknown.length === 0,
    no_classified_tool_missing: gone.length === 0,
    read_passed_the_firewall: gate.verdict === "pass",
    read_answered_by_paypal: Boolean(res && !res.isError && status),
    refund_refused_by_a_read_only_mandate: refused.verdict === "fail",
  };
  console.log(JSON.stringify({ tools: listed.length, unknown, gone, order, order_status: status, checks }, null, 2));
  const ok = Object.values(checks).every(Boolean);
  console.log(ok ? "MCP_CHECK_PASS" : "MCP_CHECK_FAIL");
  client.close();
  process.exit(ok ? 0 : 1);
} catch (e) {
  console.error("MCP_CHECK_FAIL:", (e as Error).message);
  client.close();
  process.exit(1);
}
