// A real MCP client talking to ANIMA's own endpoint (POST /mcp), as Claude Desktop or any agent would:
// it lists PayPal's tools as ANIMA labels them, reads an order through the firewall, then asks for a
// refund, which ANIMA holds for a person. Nothing here releases anything.
//   node scripts/mcp-agent-demo.ts [base-url] [order-id] [capture-id]

const base = process.argv[2] ?? "http://127.0.0.1:5275";
const order = process.argv[3];
const capture = process.argv[4];
let id = 0;

async function rpc(method: string, params: unknown = {}) {
  const res = await fetch(`${base}/mcp`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
  const json: any = await res.json();
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result;
}

const init = await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "anima-agent-demo", version: "0.1" } });
console.log("connected to:", init.serverInfo.name);
await fetch(`${base}/mcp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
const { tools } = await rpc("tools/list");
console.log(`${tools.length} tools; for example:`);
for (const name of ["get_order", "create_refund", "accept_dispute_claim", "cancel_subscription"]) {
  console.log(`  ${name}: ${tools.find((t: any) => t.name === name)?.description.slice(0, 110)}`);
}
if (order) {
  const read = await rpc("tools/call", { name: "get_order", arguments: { id: order, anima_reason: "Check the order before answering the customer." } });
  let status = "";
  try { status = JSON.parse(read.content[0].text).status; } catch { status = read.content[0].text.slice(0, 80); }
  console.log(`get_order ${order}: isError=${read.isError ?? false}, PayPal status ${status}`);
}
if (capture) {
  const refund = await rpc("tools/call", { name: "create_refund", arguments: { capture_id: capture, anima_reason: "The customer asked for a refund." } });
  console.log(`create_refund ${capture}: isError=${refund.isError}, ${refund.content[0].text.slice(0, 260)}`);
}
