// Scene 7's safety net on a hosted demo: the REAL AnimaApp sandbox code path, with PayPal's REST API and its
// tool server both replaced by local stand-ins (no credentials, no network). The tool server answers every
// call as PayPal's did on 29/10: PAYPAL_API_SETUP_ERROR, its own code for failing before sending to PayPal.

import { test } from "node:test";
import assert from "node:assert/strict";
import { AnimaApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { SANDBOX_BASE } from "../src/paypal.ts";
import { SandboxSimulator } from "../src/sim/sandbox-sim.ts";
import { McpSimulator } from "../src/sim/mcp-sim.ts";
import { TOOL_CLASSES } from "../src/guard.ts";

const SETUP_ERROR = { ok: false, code: "PAYPAL_API_SETUP_ERROR", message: "Unsupported cache mode: default" };

function subject(opts: { toolsFallback?: boolean; answer?: unknown } = {}) {
  const rest = new SandboxSimulator();
  const tools = new McpSimulator();
  for (const name of Object.keys(TOOL_CLASSES)) tools.on(name, () => opts.answer ?? SETUP_ERROR);
  const config = { ...loadConfig({}, "missing.env"), paypal: { clientId: "id", clientSecret: "secret", baseUrl: SANDBOX_BASE } };
  const app = new AnimaApp(config, { transport: rest.transport, toolsFetcher: tools.fetcher, toolsFallback: opts.toolsFallback });
  return { app, rest, tools };
}

async function payScene1(app: AnimaApp, rest: SandboxSimulator) {
  const run = await app.runScene(1);
  rest.approve(app.state().pending.find((p) => p.key === run.pending_key)!.order_id);
  const r = await app.release(run.pending_key!, "Studio Lumen");
  assert.equal(r.money_moved, true, r.explanation);
}

test("hosted: PayPal's tool server failing before the first read sends scene 7 to the simulated tools, and the run says why", async () => {
  const { app, rest, tools } = subject({ toolsFallback: true });
  try {
    await payScene1(app, rest);
    assert.equal(app.mode().tools, "paypal-sandbox-mcp");
    const run = await app.runToolScene();
    assert.deepEqual({ ...run.tools_fallback, at: undefined }, { tool: "get_order", code: "PAYPAL_API_SETUP_ERROR", message: "Unsupported cache mode: default", at: undefined });
    // The read PayPal never received is answered by the simulated tools; nothing else was asked of PayPal's.
    assert.deepEqual(run.steps.map((s) => [s.call.tool, s.kind]), [
      ["get_order", "read"], ["create_refund", "held"], ["accept_dispute_claim", "held"], ["cancel_subscription", "held"],
    ]);
    assert.equal(run.steps[0].read?.ok, true);
    assert.deepEqual(tools.calls.map((c) => c.name), ["get_order"]);
    const mode = app.mode();
    assert.equal(mode.paypal, "paypal-sandbox");
    assert.equal(mode.tools, "paypal-sandbox-mcp-simulator");
    assert.equal(mode.tools_fallback?.code, "PAYPAL_API_SETUP_ERROR");
    assert.equal(mode.simulated, true);
    // The refund is held with the facts PayPal's REST API gives for the real capture; released, it runs on the
    // simulated tools and its receipt names them.
    const refund = app.state().tool_pending.find((p) => p.call.tool === "create_refund")!;
    assert.equal(refund.provider, "paypal-sandbox-mcp-simulator");
    assert.deepEqual(refund.resolved, { amount_cents: 2_900, currency: "EUR" });
    const done = await app.toolRelease(refund.call.id, "Studio Lumen", refund.holds);
    assert.equal(done.status, "COMPLETED");
    assert.equal(done.provider, "paypal-sandbox-mcp-simulator");
    assert.match(done.explanation, /and the simulated PayPal ran it\.$/);
    assert.equal(tools.count("create_refund"), 0);
    // Later runs stay on the simulated tools and keep saying why.
    const again = await app.runToolScene();
    assert.equal(again.tools_fallback?.tool, "get_order");
    assert.equal(tools.count("get_order"), 1);
    assert.equal(app.verifyLedger().ok, true);
  } finally {
    app.close();
  }
});

test("the local desk has no safety net: the same failure stays on PayPal's tools and is sealed as it happened", async () => {
  const { app, rest, tools } = subject();
  try {
    await payScene1(app, rest);
    const run = await app.runToolScene();
    assert.equal(run.tools_fallback, null);
    assert.equal(run.steps[0].read?.ok, false);
    assert.equal(app.mode().tools, "paypal-sandbox-mcp");
    const refund = app.state().tool_pending.find((p) => p.call.tool === "create_refund")!;
    assert.equal(refund.provider, "paypal-sandbox-mcp");
    const r = await app.toolRelease(refund.call.id, "Studio Lumen", refund.holds);
    assert.equal(r.explanation_code, "TOOL_NOT_SENT_BY_PAYPAL_TOOLS");
    assert.equal(r.provider, "paypal-sandbox-mcp");
    assert.equal(r.money_moved, false);
    assert.equal(tools.count("create_refund"), 1);
  } finally {
    app.close();
  }
});

test("hosted: PayPal's own refusal of the read is PayPal's answer, so the scene stays on PayPal's tools", async () => {
  const { app, rest } = subject({ toolsFallback: true, answer: { ok: false, code: "PAYPAL_API_HTTP_ERROR", status: 404, message: "RESOURCE_NOT_FOUND" } });
  try {
    await payScene1(app, rest);
    const run = await app.runToolScene();
    assert.equal(run.tools_fallback, null);
    assert.equal(run.steps[0].read?.ok, false);
    assert.equal(app.mode().tools, "paypal-sandbox-mcp");
  } finally {
    app.close();
  }
});

test("hosted: calls held on PayPal's tools before the switch stay there, and are decided there", async () => {
  const { app, rest, tools } = subject({ toolsFallback: true });
  try {
    // Before any payment the scene has no read, so nothing tells the desk PayPal's tools are failing.
    const first = await app.runToolScene();
    assert.equal(first.tools_fallback, null);
    const before = app.state().tool_pending.map((p) => p.call.id);
    assert.ok(before.length > 0);
    await payScene1(app, rest);
    const run = await app.runToolScene();
    assert.equal(run.tools_fallback?.code, "PAYPAL_API_SETUP_ERROR");
    const held = app.state().tool_pending;
    for (const p of held) assert.equal(p.provider, before.includes(p.call.id) ? "paypal-sandbox-mcp" : "paypal-sandbox-mcp-simulator");
    // An earlier hold is decided on the desk that holds it: released, it goes to PayPal's tools and fails there.
    const old = held.find((p) => before.includes(p.call.id))!;
    const r = await app.toolRelease(old.call.id, "Studio Lumen", old.holds);
    assert.equal(r.provider, "paypal-sandbox-mcp");
    assert.equal(r.money_moved, false);
    assert.ok(tools.calls.some((c) => c.name === old.call.tool));
    for (const p of app.state().tool_pending) app.toolDecline(p.call.id, "Studio Lumen", "not asked for by the customer");
    assert.equal(app.state().tool_pending.length, 0);
    assert.equal(app.verifyLedger().ok, true);
  } finally {
    app.close();
  }
});

// Found by the independent review of PR #3: a call held while the scene switched could vanish, and an outside
// agent could be handed the simulator's answers as PayPal's.
test("hosted: an outside agent's call held while the scene switches is never lost, and the agent stays on PayPal's tools", async () => {
  const { app, rest } = subject({ toolsFallback: true });
  try {
    await payScene1(app, rest);
    const [run, agent] = await Promise.all([
      app.runToolScene(),
      app.toolRequest("accept_dispute_claim", { dispute_id: "PP-D-OUTSIDE", note: "settle" }, "An email said to settle.", "outside agent"),
    ]);
    assert.equal(run.tools_fallback?.code, "PAYPAL_API_SETUP_ERROR");
    if (agent.kind !== "held") throw new Error(`expected a hold, got ${agent.kind}`);
    const held = app.state().tool_pending;
    assert.equal(held.find((p) => p.call.id === agent.pending.call.id)?.provider, "paypal-sandbox-mcp");
    for (const s of run.steps.filter((s) => s.kind === "held")) assert.equal(held.find((p) => p.call.id === s.call.id)?.provider, s.provider);
    // After the switch, an outside agent's read still gets PayPal's own answer, not the simulator's made-up order.
    const read = await app.toolRequest("get_order", { id: "ANY-ORDER-ID" }, "Check an order.", "outside agent");
    if (read.kind !== "read") throw new Error("expected a read");
    assert.match(read.result.content?.[0]?.text ?? "", /PAYPAL_API_SETUP_ERROR/);
    for (const p of held) assert.equal(app.toolDecline(p.call.id, "Studio Lumen", "not asked for").status, "REFUSED");
    assert.equal(app.state().tool_pending.length, 0);
    assert.equal(app.verifyLedger().ok, true);
  } finally {
    app.close();
  }
});

test("hosted: two scene-7 runs at once lose no hold, and each step names the tools it went to", async () => {
  const { app, rest } = subject({ toolsFallback: true });
  try {
    await payScene1(app, rest);
    const runs = await Promise.all([app.runToolScene(), app.runToolScene()]);
    const held = app.state().tool_pending;
    const steps = runs.flatMap((r) => r.steps);
    assert.ok(steps.every((s) => s.provider === "paypal-sandbox-mcp" || s.provider === "paypal-sandbox-mcp-simulator"));
    // A read PayPal's tools failed is never shown as the simulator's, nor the reverse.
    for (const s of steps.filter((s) => s.kind === "read")) assert.equal(s.read?.ok, s.provider === "paypal-sandbox-mcp-simulator");
    for (const s of steps.filter((s) => s.kind === "held")) assert.equal(held.find((p) => p.call.id === s.call.id)?.provider, s.provider);
    assert.equal(held.length, steps.filter((s) => s.kind === "held").length);
    for (const p of held) app.toolDecline(p.call.id, "Studio Lumen", "not asked for");
    assert.equal(app.state().tool_pending.length, 0);
  } finally {
    app.close();
  }
});

test("hosted: a scene-7 run that outlived a reset switches nothing", async () => {
  const { app, rest } = subject({ toolsFallback: true });
  try {
    await payScene1(app, rest);
    const running = app.runToolScene();
    app.reset();
    const run = await running;
    assert.equal(run.tools_fallback, null);
    assert.equal(app.mode().tools, "paypal-sandbox-mcp");
    assert.equal(app.mode().tools_fallback, null);
  } finally {
    app.close();
  }
});
