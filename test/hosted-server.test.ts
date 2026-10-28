// The real server as the host runs it: a copy of src/ and web/ with no .env beside it, started with
// ANIMA_HOSTED=1 on loopback. A model is configured on purpose: visitors must still get scripted advice
// unless ANIMA_HOSTED_MODEL is exactly 1. Also checked end to end: a session per visitor, the page's CSP,
// /mcp behind the session token, and no write from a foreign origin.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const MODEL = "a-configured-model-that-must-not-answer";
const SCRIPTED = "scripted answers (no model configured)";

async function startHosted(hostedModel: string | undefined) {
  const dir = mkdtempSync(join(tmpdir(), "anima-hosted-"));
  for (const d of ["src", "web"]) cpSync(join(REPO, d), join(dir, d), { recursive: true });
  cpSync(join(REPO, "package.json"), join(dir, "package.json"));
  const port = 20_000 + Math.floor(Math.random() * 20_000);
  const env: Record<string, string> = { ...process.env as Record<string, string>, HOST: "127.0.0.1", PORT: String(port), ANIMA_HOSTED: "1", ANIMA_SIMULATE: "1",
    ADVISOR_KIND: "openai-compatible", ADVISOR_BASE_URL: "http://127.0.0.1:9", ADVISOR_MODEL: MODEL, ADVISOR_API_KEY: "" };
  for (const k of ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "ANIMA_PUBLIC_ORIGIN", "RENDER_EXTERNAL_URL", "ANIMA_HOSTED_MODEL", "ANIMA_SCENE_BUDGET", "ANIMA_GLOBAL_SCENE_BUDGET", "ANIMA_MAX_SESSIONS"]) delete env[k];
  if (hostedModel !== undefined) env.ANIMA_HOSTED_MODEL = hostedModel;
  const child = spawn(process.execPath, [join(dir, "src", "server.ts")], { env, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no start within 20 s: ${log}`)), 20_000);
    const read = (d: Buffer) => { log += d; if (log.includes("ANIMA on")) { clearTimeout(timer); resolve(); } };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`exited with ${code} before listening: ${log}`)); });
  });
  const stop = async () => { child.kill(); await once(child, "exit").catch(() => {}); rmSync(dir, { recursive: true, force: true }); };
  return { base: `http://127.0.0.1:${port}`, log: () => log, stop };
}

const json = { "Content-Type": "application/json" };

async function visitor(base: string) {
  const boot = await fetch(`${base}/api/session`, { method: "POST", headers: { ...json, Origin: base }, body: "{}" });
  assert.equal(boot.status, 200);
  const cookie = boot.headers.get("set-cookie")!.split(";")[0];
  return {
    cookie,
    state: async () => (await fetch(`${base}/api/state`, { headers: { Cookie: cookie } })).json() as Promise<any>,
    post: (p: string, origin = base) => fetch(`${base}${p}`, { method: "POST", headers: { ...json, Origin: origin, Cookie: cookie }, body: "{}" }),
  };
}

test("the real hosted server, without a .env and with a model configured: scripted advice, a session per visitor, CSP, /mcp token, no foreign write", async () => {
  const s = await startHosted("0");
  try {
    assert.match(s.log(), /hosted: a session per visitor, loopback only/);
    assert.match(s.log(), /advisor: 'not configured'/);
    assert.doesNotMatch(s.log(), new RegExp(MODEL));

    const page = await fetch(`${s.base}/`);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get("set-cookie"), null);
    assert.match(page.headers.get("content-security-policy")!, /script-src 'self' https:\/\/cdn\.jsdelivr\.net\/npm\/ag-grid-community@32\.3\.3\/dist\/ag-grid-community\.min\.js;/);

    const a = await visitor(s.base);
    const b = await visitor(s.base);
    assert.notEqual(a.cookie, b.cookie);
    const st = await a.state();
    assert.equal(st.mode.advisor, SCRIPTED);
    assert.equal(st.mode.paypal, "simulated-sandbox");
    assert.equal(st.mode.simulated, true);

    // The poisoned invoice, on scripted advice: the configured model is never asked.
    const run = await (await a.post("/api/scenes/3")).json() as any;
    assert.equal(run.model, SCRIPTED);
    assert.equal((await b.state()).receipts.length, 0, "a visitor sees nothing of another's");

    assert.equal((await a.post("/api/scenes/1", "https://evil.example")).status, 403);
    const list = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    assert.equal((await fetch(`${s.base}/mcp`, { method: "POST", headers: json, body: list })).status, 401);
    const ok = await fetch(`${s.base}/mcp`, { method: "POST", headers: { ...json, Authorization: `Bearer ${st.session.mcp_token}` }, body: list });
    assert.equal(ok.status, 200);
  } finally { await s.stop(); }
});

test("the real hosted server answers visitors with the configured model only when ANIMA_HOSTED_MODEL is exactly 1", async () => {
  for (const [value, expected] of [[undefined, SCRIPTED], ["true", SCRIPTED], ["1", MODEL]] as const) {
    const s = await startHosted(value);
    try {
      const st = await (await visitor(s.base)).state();
      assert.equal(st.mode.advisor, expected, `ANIMA_HOSTED_MODEL=${value}`);
    } finally { await s.stop(); }
  }
});
