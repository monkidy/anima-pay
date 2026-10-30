// The negative controls of Asso's P0 (#3199, 6364397553) against the real HTTP surface: no other site
// may act on the local desk; in hosted mode an anonymous visitor can do nothing, the person is named by
// the server, one visitor cannot see or release another's payments, and model-backed runs are bounded.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, request, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import { AnimaApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { createAnimaHandler, type HttpOptions } from "../src/http.ts";

const WEB = fileURLToPath(new URL("../web/", import.meta.url));
const sim = () => new AnimaApp(loadConfig({}, "missing.env"));

async function serve(opts: Omit<HttpOptions, "port" | "webDir">) {
  let surface!: ReturnType<typeof createAnimaHandler>;
  const server: Server = createServer((req, res) => void surface.handler(req, res));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as any).port as number;
  surface = createAnimaHandler({ ...opts, port, webDir: WEB });
  const base = `http://127.0.0.1:${port}`;
  const close = () => { surface.close(); return new Promise<void>((r) => server.close(() => r())); };
  return { base, surface, close };
}

const json = { "Content-Type": "application/json" };

test("local desk: another site's page cannot act on it, and writes must be JSON", async () => {
  const { base, close } = await serve({ hosted: false, app: sim() });
  try {
    const evil = await fetch(`${base}/api/scenes/1`, { method: "POST", headers: { ...json, Origin: "https://evil.example" }, body: "{}" });
    assert.equal(evil.status, 403);
    const form = await fetch(`${base}/api/scenes/1`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: "{}" });
    assert.equal(form.status, 415);
    const own = await fetch(`${base}/api/scenes/1`, { method: "POST", headers: { ...json, Origin: base }, body: "{}" });
    assert.equal(own.status, 200);
    const script = await fetch(`${base}/api/scenes/2`, { method: "POST", headers: json, body: "{}" });
    assert.equal(script.status, 200);
    const mcp = await fetch(`${base}/mcp`, { method: "POST", headers: { ...json, Origin: "https://evil.example" }, body: "{}" });
    assert.equal(mcp.status, 403);
  } finally { await close(); }
});

async function visitor(base: string) {
  // The page asks for its session explicitly, same origin; loading the page opens none.
  const boot = await fetch(`${base}/api/session`, { method: "POST", headers: { ...json, Origin: base }, body: "{}" });
  assert.equal(boot.status, 200, await boot.clone().text());
  const cookie = boot.headers.get("set-cookie")!.split(";")[0];
  const h = { ...json, Origin: base, Cookie: cookie };
  const get = async (p: string) => (await fetch(`${base}${p}`, { headers: { Cookie: cookie } })).json() as Promise<any>;
  const post = (p: string, body: unknown = {}) => fetch(`${base}${p}`, { method: "POST", headers: h, body: JSON.stringify(body) });
  return { cookie, get, post };
}

test("hosted: anonymous requests do nothing; the person is named by the server; visitors are isolated", async () => {
  const { base, close } = await serve({ hosted: true, makeApp: sim });
  try {
    assert.equal((await fetch(`${base}/api/scenes/1`, { method: "POST", headers: { ...json, Origin: base }, body: "{}" })).status, 401);
    assert.equal((await fetch(`${base}/api/state`)).status, 401);

    const a = await visitor(base);
    const b = await visitor(base);
    assert.notEqual(a.cookie, b.cookie);
    assert.equal((await a.post("/api/scenes/1")).status, 200);
    const key = (await a.get("/api/state")).pending[0].key;
    assert.equal((await a.post(`/api/pending/${key}/approve`)).status, 200);

    // B sees nothing of A's, and cannot release, decline or reset A's payment.
    assert.equal((await b.get("/api/state")).pending.length, 0);
    assert.equal((await b.post(`/api/pending/${key}/release`, { by: "Studio Lumen" })).status, 400);
    assert.equal((await b.post("/api/reset")).status, 200);
    assert.equal((await a.get("/api/state")).pending.length, 1);

    // A's release names A's session, whatever the request claims; a write without the page's Origin fails.
    assert.equal((await fetch(`${base}/api/pending/${key}/release`, { method: "POST", headers: { ...json, Cookie: a.cookie }, body: "{}" })).status, 403);
    const paid = await (await a.post(`/api/pending/${key}/release`, { by: "Mallory", acknowledged: [] })).json() as any;
    assert.equal(paid.money_moved, true);
    assert.match(paid.explanation, /demo visitor [A-Za-z0-9_-]{6} released it/);
    assert.doesNotMatch(paid.explanation, /Mallory/);
  } finally { await close(); }
});

test("hosted: an agent needs its own session's token; runs are bounded per session", async () => {
  const { base, close } = await serve({ hosted: true, makeApp: sim, sceneBudget: 2 });
  try {
    const a = await visitor(base);
    const token = (await a.get("/api/state")).session.mcp_token;
    const list = { jsonrpc: "2.0", id: 1, method: "tools/list" };
    assert.equal((await fetch(`${base}/mcp`, { method: "POST", headers: json, body: JSON.stringify(list) })).status, 401);
    assert.equal((await fetch(`${base}/mcp`, { method: "POST", headers: { ...json, Authorization: "Bearer not-a-token" }, body: JSON.stringify(list) })).status, 401);
    const ok = await (await fetch(`${base}/mcp`, { method: "POST", headers: { ...json, Authorization: `Bearer ${token}` }, body: JSON.stringify(list) })).json() as any;
    assert.equal(ok.result.tools.length, 46);
    assert.equal((await a.post("/api/scenes/1")).status, 200);
    assert.equal((await a.post("/api/scenes/2")).status, 200);
    assert.equal((await a.post("/api/scenes/3")).status, 429);
  } finally { await close(); }
});

test("hosted mode refuses to start on a public interface without an exact https origin", async () => {
  const { hostedStartupProblem } = await import("../src/http.ts");
  assert.match(hostedStartupProblem({ host: "0.0.0.0" })!, /needs ANIMA_PUBLIC_ORIGIN/);
  assert.match(hostedStartupProblem({ host: "0.0.0.0", publicOrigin: "http://anima.example" })!, /must be https/);
  assert.match(hostedStartupProblem({ host: "0.0.0.0", publicOrigin: "https://anima.example/" })!, /without path/);
  assert.equal(hostedStartupProblem({ host: "0.0.0.0", publicOrigin: "https://anima.example" }), null);
  assert.equal(hostedStartupProblem({ host: "127.0.0.1" }), null);
});

test("hosted with an https origin: the session cookie is Secure, and every page carries a strict CSP", async () => {
  const origin = "https://anima.example";
  const { base, close } = await serve({ hosted: true, makeApp: sim, publicOrigin: origin });
  try {
    const page = await fetch(`${base}/`);
    assert.match(page.headers.get("content-security-policy")!, /frame-ancestors 'none'/);
    // AG Grid's icons are inline fonts: blocking them silently broke the ledger's sort arrows.
    assert.match(page.headers.get("content-security-policy")!, /font-src 'self' data:/);
    const boot = await fetch(`${base}/api/session`, { method: "POST", headers: { ...json, Origin: origin }, body: "{}" });
    assert.match(boot.headers.get("set-cookie")!, /; Secure/);
    assert.equal(page.headers.get("strict-transport-security"), "max-age=31536000");
  } finally { await close(); }
});

test("hosted with a public origin: only that origin may write; the loopback page and any Host-derived origin are foreign", async () => {
  const origin = "https://anima.example";
  const { base, close } = await serve({ hosted: true, makeApp: sim, publicOrigin: origin });
  try {
    const host = new URL(base).host;
    for (const foreign of [base, `http://localhost:${new URL(base).port}`, `https://${host}`, `http://${host}`, "https://evil.example", "null"]) {
      const r = await fetch(`${base}/api/session`, { method: "POST", headers: { ...json, Origin: foreign }, body: "{}" });
      assert.equal(r.status, 403, foreign);
      assert.equal(r.headers.get("set-cookie"), null, foreign);
    }
    const boot = await fetch(`${base}/api/session`, { method: "POST", headers: { ...json, Origin: origin }, body: "{}" });
    assert.equal(boot.status, 200);
    const cookie = boot.headers.get("set-cookie")!.split(";")[0];
    const write = (o: string) => fetch(`${base}/api/scenes/1`, { method: "POST", headers: { ...json, Origin: o, Cookie: cookie }, body: "{}" });
    assert.equal((await write(base)).status, 403);
    assert.equal((await write(origin)).status, 200);
  } finally { await close(); }
});

/** A raw request, so the Host header can be what a rebound name would send. */
function raw(base: string, path: string, headers: Record<string, string>, method = "GET", body?: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(`${base}${path}`, { method, headers }, (res) => { res.resume(); resolve(res.statusCode!); });
    req.on("error", reject);
    req.end(body);
  });
}

test("local desk: a page that rebinds its own name to 127.0.0.1 can neither write nor read", async () => {
  const { base, close } = await serve({ hosted: false, app: sim() });
  try {
    const port = new URL(base).port;
    const rebound = { Host: `rebind.example:${port}`, Origin: `http://rebind.example:${port}` };
    assert.equal(await raw(base, "/api/scenes/1", { ...rebound, "Content-Type": "application/json" }, "POST", "{}"), 421);
    assert.equal(await raw(base, "/api/state", { Host: rebound.Host }), 421);
    assert.equal(await raw(base, "/mcp", { ...rebound, "Content-Type": "application/json" }, "POST", JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })), 421);
    // Even with a loopback Host, an Origin that names another host is not the desk's own page.
    assert.equal(await raw(base, "/api/scenes/1", { Host: `127.0.0.1:${port}`, Origin: `http://rebind.example:${port}`, "Content-Type": "application/json" }, "POST", "{}"), 403);
    assert.equal(await raw(base, "/api/state", { Host: `localhost:${port}` }), 200);
  } finally { await close(); }
});

test("hosted: an agent's tool calls spend the session's runs, one per call, batches included", async () => {
  const { base, close } = await serve({ hosted: true, makeApp: sim, sceneBudget: 3 });
  try {
    const a = await visitor(base);
    const token = (await a.get("/api/state")).session.mcp_token;
    const rpc = (body: unknown) => fetch(`${base}/mcp`, { method: "POST", headers: { ...json, Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    const call = (id: number) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "accept_dispute_claim", arguments: { dispute_id: "PP-D-1", anima_reason: "test" } } });
    // Listing and pinging reach nothing that costs: they are free.
    for (let i = 0; i < 5; i++) assert.equal((await rpc({ jsonrpc: "2.0", id: 100 + i, method: "tools/list" })).status, 200);
    assert.equal((await rpc(call(1))).status, 200);
    assert.equal((await a.get("/api/state")).session.scenes_left, 2);
    // A batch of three with two runs left is refused whole: nothing of it runs, nothing is spent.
    assert.equal((await rpc([call(5), call(6), call(7)])).status, 429);
    assert.equal((await a.get("/api/state")).session.scenes_left, 2);
    assert.equal((await a.get("/api/state")).tool_pending.length, 1);
    // A batch of two with two runs left passes; one more call is refused, and so is a scene.
    assert.equal((await rpc([call(2), call(3)])).status, 200);
    assert.equal((await a.get("/api/state")).session.scenes_left, 0);
    assert.equal((await rpc(call(4))).status, 429);
    assert.equal((await a.post("/api/scenes/1")).status, 429);
  } finally { await close(); }
});

test("hosted: a batch larger than what is left is refused whole, and tool calls count host-wide too", async () => {
  const { base, close } = await serve({ hosted: true, makeApp: sim, sceneBudget: 40, globalSceneBudget: 3 });
  try {
    const call = (id: number) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "cancel_subscription", arguments: { subscription_id: "I-X" } } });
    const a = await visitor(base);
    const token = (await a.get("/api/state")).session.mcp_token;
    const rpc = (body: unknown) => fetch(`${base}/mcp`, { method: "POST", headers: { ...json, Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    assert.equal((await rpc([call(1), call(2), call(3), call(4)])).status, 429);
    assert.equal((await a.get("/api/state")).tool_receipts.length + (await a.get("/api/state")).tool_pending.length, 0);
    assert.equal((await rpc([call(1), call(2)])).status, 200);
    const b = await visitor(base);
    assert.equal((await b.post("/api/scenes/1")).status, 200);
    assert.equal((await b.post("/api/scenes/2")).status, 429);
  } finally { await close(); }
});

test("the page's CSP names its exact external files: no bare CDN host may serve a script", async () => {
  const { readFileSync } = await import("node:fs");
  const { CSP } = await import("../src/http.ts");
  const html = readFileSync(fileURLToPath(new URL("../web/index.html", import.meta.url)), "utf8");
  const directive = (name: string) => CSP.split("; ").find((d) => d.startsWith(`${name} `))!.split(" ").slice(1);
  const allows = (sources: string[], url: string) => sources.some((s) => s === url || (s.endsWith("/") && url.startsWith(s)));
  const scripts = [...html.matchAll(/<script[^>]*\bsrc="(https:[^"]+)"/g)].map((m) => m[1]);
  const styles = [...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="(https:[^"]+)"/g)].map((m) => m[1]);
  assert.ok(scripts.length >= 1 && styles.length >= 5, `found ${scripts.length} scripts, ${styles.length} stylesheets`);
  for (const u of scripts) assert.ok(allows(directive("script-src"), u), `script-src must allow ${u}`);
  for (const u of styles) assert.ok(allows(directive("style-src"), u), `style-src must allow ${u}`);
  for (const name of ["script-src", "style-src", "font-src", "default-src", "connect-src", "img-src"]) {
    for (const s of directive(name)) assert.doesNotMatch(s, /^https?:\/\/[^/]+\/?$|^https?:$|^\*$/, `${name} must not allow a whole host: ${s}`);
  }
  assert.doesNotMatch(directive("script-src").join(" "), /'unsafe-inline'|'unsafe-eval'/);
  assert.deepEqual(directive("frame-ancestors"), ["'none'"]);
  assert.deepEqual(directive("object-src"), ["'none'"]);
  // No inline script on the page: script-src would refuse it, and nothing else may run.
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/);
  assert.doesNotMatch(html, /\son[a-z]+="/i);
});

test("JSON answers are never pages: nosniff, no store, a deny-all CSP", async () => {
  const { base, close } = await serve({ hosted: true, makeApp: sim });
  try {
    for (const r of [await fetch(`${base}/api/state`), await fetch(`${base}/no-such-file.txt`), await (await visitor(base)).post("/api/scenes/1")]) {
      assert.equal(r.headers.get("x-content-type-options"), "nosniff");
      assert.equal(r.headers.get("cache-control"), "no-store");
      assert.equal(r.headers.get("content-security-policy"), "default-src 'none'; frame-ancestors 'none'");
    }
  } finally { await close(); }
});

test("limits from the environment: unset takes the default, a typo refuses to start instead of switching the budget off", async () => {
  const { parseLimit } = await import("../src/http.ts");
  assert.equal(parseLimit("X", undefined, 40), 40);
  assert.equal(parseLimit("X", "", 40), 40);
  assert.equal(parseLimit("X", "0", 40), 0);
  assert.equal(parseLimit("X", "12", 40), 12);
  for (const bad of ["4O", "abc", "-1", "1.5", "1e3", " ", "NaN", "Infinity"]) assert.throws(() => parseLimit("X", bad, 40), /refusing to start/, bad);
  assert.throws(() => parseLimit("ANIMA_MAX_SESSIONS", "0", 50, 1), /at least 1/);
});

test("the public origin: ANIMA_PUBLIC_ORIGIN first, else Render's own address in hosted mode only, held to the same rules", async () => {
  const { resolvePublicOrigin, startupProblem } = await import("../src/http.ts");
  assert.equal(resolvePublicOrigin({ ANIMA_PUBLIC_ORIGIN: "https://anima.example", RENDER_EXTERNAL_URL: "https://x.onrender.com" }), "https://anima.example");
  assert.equal(resolvePublicOrigin({ ANIMA_HOSTED: "1", RENDER_EXTERNAL_URL: "https://anima-demo.onrender.com" }), "https://anima-demo.onrender.com");
  assert.equal(resolvePublicOrigin({ ANIMA_HOSTED: "1", RENDER_EXTERNAL_URL: "https://anima-demo.onrender.com/" }), "https://anima-demo.onrender.com");
  assert.equal(resolvePublicOrigin({ RENDER_EXTERNAL_URL: "https://anima-demo.onrender.com" }), undefined);
  assert.equal(resolvePublicOrigin({ ANIMA_HOSTED: "1" }), undefined);
  // Whatever it resolves to still has to be an exact https origin, or nothing starts.
  const env = { ANIMA_HOSTED: "1", RENDER_EXTERNAL_URL: "http://anima-demo.onrender.com" };
  assert.match(startupProblem({ host: "0.0.0.0", hosted: "1", publicOrigin: resolvePublicOrigin(env) })!, /must be https/);
  assert.match(startupProblem({ host: "0.0.0.0", hosted: "1", publicOrigin: resolvePublicOrigin({ ANIMA_HOSTED: "1", RENDER_EXTERNAL_URL: "not a url" }) })!, /not a URL/);
});

test("a hosted desk's advisor: scripted unless ANIMA_HOSTED_MODEL is exactly 1", async () => {
  const { hostedConfig } = await import("../src/config.ts");
  const configured = loadConfig({ ADVISOR_KIND: "openai-compatible", ADVISOR_BASE_URL: "http://127.0.0.1:9", ADVISOR_MODEL: "m" }, "missing.env");
  assert.ok(configured.advisor);
  for (const v of [undefined, "", "0", "true", "yes", "1 ", " 1", "01"]) assert.equal(hostedConfig(configured, { ANIMA_HOSTED_MODEL: v }).advisor, null, String(v));
  assert.deepEqual(hostedConfig(configured, { ANIMA_HOSTED_MODEL: "1" }).advisor, configured.advisor);
  assert.equal(hostedConfig(configured, {}).paypal, configured.paypal);
});

test("local desk: the page's session bootstrap answers without a cookie, and plain http pages carry no HSTS", async () => {
  const { base, close } = await serve({ hosted: false, app: sim() });
  try {
    const boot = await fetch(`${base}/api/session`, { method: "POST", headers: { ...json, Origin: base }, body: "{}" });
    assert.equal(boot.status, 200);
    assert.deepEqual(await boot.json(), { principal: "the account owner", created: false });
    assert.equal(boot.headers.get("set-cookie"), null);
    const evil = await fetch(`${base}/api/session`, { method: "POST", headers: { ...json, Origin: "https://evil.example" }, body: "{}" });
    assert.equal(evil.status, 403);
    const page = await fetch(`${base}/`);
    assert.equal(page.headers.get("strict-transport-security"), null);
  } finally { await close(); }
});

test("hosted: opening new sessions cannot buy new runs past the host-wide budget", async () => {
  const { base, close } = await serve({ hosted: true, makeApp: sim, sceneBudget: 40, globalSceneBudget: 3 });
  try {
    for (let i = 0; i < 3; i++) assert.equal((await (await visitor(base)).post("/api/scenes/1")).status, 200);
    const churned = await visitor(base);
    const r = await churned.post("/api/scenes/1");
    assert.equal(r.status, 429);
    assert.match(((await r.json()) as any).error, /last 24 hours/);
  } finally { await close(); }
});

test("a non-loopback bind needs ANIMA_HOSTED exactly 1: absent, 0 or a typo refuse; loopback local stays allowed", async () => {
  const { startupProblem } = await import("../src/http.ts");
  for (const hosted of [undefined, "0", "true", "1 ", "yes"]) {
    assert.match(startupProblem({ host: "0.0.0.0", hosted })!, /ANIMA_HOSTED must be exactly 1/, String(hosted));
  }
  assert.match(startupProblem({ host: "::", hosted: undefined })!, /not loopback/);
  assert.equal(startupProblem({ host: "0.0.0.0", hosted: "1", publicOrigin: "https://anima-demo.onrender.com" }), null);
  assert.match(startupProblem({ host: "0.0.0.0", hosted: "1" })!, /needs ANIMA_PUBLIC_ORIGIN/);
  assert.equal(startupProblem({ host: "127.0.0.1", hosted: undefined }), null);
  assert.equal(startupProblem({ host: "localhost", hosted: "0" }), null);
});

test("the real server exits before listening when bound to a public interface without hosted mode", async () => {
  const { spawnSync } = await import("node:child_process");
  const server = fileURLToPath(new URL("../src/server.ts", import.meta.url));
  for (const hosted of [undefined, "0", "hostd"]) {
    const env: Record<string, string> = { ...process.env as Record<string, string>, HOST: "0.0.0.0", PORT: "5298", ANIMA_SIMULATE: "1" };
    delete env.ANIMA_HOSTED;
    if (hosted !== undefined) env.ANIMA_HOSTED = hosted;
    const r = spawnSync(process.execPath, [server], { env, encoding: "utf8", timeout: 20_000 });
    assert.equal(r.status, 1, `ANIMA_HOSTED=${hosted}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /refusing to start/);
    assert.doesNotMatch(r.stdout, /ANIMA on/);
  }
});

test("the real server in hosted mode exits before listening on a public interface without an exact https origin, or with a bad limit", async () => {
  const { spawnSync } = await import("node:child_process");
  const server = fileURLToPath(new URL("../src/server.ts", import.meta.url));
  const cases: [Record<string, string>, RegExp][] = [
    [{}, /needs ANIMA_PUBLIC_ORIGIN/],
    [{ ANIMA_PUBLIC_ORIGIN: "http://anima.example" }, /must be https/],
    [{ ANIMA_PUBLIC_ORIGIN: "https://anima.example/" }, /without path/],
    [{ ANIMA_PUBLIC_ORIGIN: "anima.example" }, /not a URL/],
    [{ RENDER_EXTERNAL_URL: "http://anima-demo.onrender.com" }, /must be https/],
    // These two would start (a valid origin), so they must stop at the limit, before any port opens.
    [{ ANIMA_PUBLIC_ORIGIN: "https://anima.example", ANIMA_SCENE_BUDGET: "4O" }, /ANIMA_SCENE_BUDGET must be a whole number/],
    [{ ANIMA_PUBLIC_ORIGIN: "https://anima.example", ANIMA_MAX_SESSIONS: "0" }, /ANIMA_MAX_SESSIONS must be a whole number of at least 1/],
    [{ ANIMA_PUBLIC_ORIGIN: "https://anima.example", ANIMA_CLIENT_SESSIONS: "0" }, /ANIMA_CLIENT_SESSIONS must be a whole number of at least 1/],
    [{ ANIMA_PUBLIC_ORIGIN: "https://anima.example", ANIMA_VIDEO_URL: "http://video.example" }, /ANIMA_VIDEO_URL must be https/],
  ];
  for (const [extra, why] of cases) {
    const env: Record<string, string> = { ...process.env as Record<string, string>, HOST: "0.0.0.0", PORT: "5298", ANIMA_SIMULATE: "1", ANIMA_HOSTED: "1", ...extra };
    for (const k of ["ANIMA_PUBLIC_ORIGIN", "RENDER_EXTERNAL_URL", "ANIMA_SCENE_BUDGET", "ANIMA_MAX_SESSIONS", "ANIMA_GLOBAL_SCENE_BUDGET", "ANIMA_CLIENT_SCENE_BUDGET", "ANIMA_CLIENT_SESSIONS", "ANIMA_VIDEO_URL", "RENDER"]) if (!(k in extra)) delete env[k];
    const r = spawnSync(process.execPath, [server], { env, encoding: "utf8", timeout: 20_000 });
    assert.equal(r.status, 1, `${JSON.stringify(extra)}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, why, JSON.stringify(extra));
    assert.doesNotMatch(r.stdout, /ANIMA on/);
  }
});

test("hosted: the host's health probe (a static file, no cookie) never opens a session", async () => {
  const { base, surface, close } = await serve({ hosted: true, makeApp: sim, maxSessions: 2 });
  try {
    for (let i = 0; i < 5; i++) {
      const probe = await fetch(`${base}/style.css`);
      assert.equal(probe.status, 200);
      assert.equal(probe.headers.get("set-cookie"), null);
    }
    assert.equal(surface.sessionCount(), 0);
  } finally { await close(); }
});

test("render.yaml points the health probe at a static file, not at the page", async () => {
  const { readFileSync } = await import("node:fs");
  const yaml = readFileSync(fileURLToPath(new URL("../render.yaml", import.meta.url)), "utf8");
  assert.match(yaml, /^\s*healthCheckPath: \/style\.css\s*$/m);
});

test("render.yaml: hosted mode on, a live model behind the safety net, no auto-deploy, and only secrets typed by hand", async () => {
  const { readFileSync } = await import("node:fs");
  const yaml = readFileSync(fileURLToPath(new URL("../render.yaml", import.meta.url)), "utf8");
  const value = (key: string) => new RegExp(`- key: ${key}\\s*\\n\\s*value: "?([^"\\n]*)"?`).exec(yaml)?.[1];
  assert.equal(value("ANIMA_HOSTED"), "1");
  // Decided 29/10: visitors run on a real model; the safety net falls back to the script, labelled.
  assert.equal(value("ANIMA_HOSTED_MODEL"), "1");
  assert.equal(value("ADVISOR_KIND"), "anthropic");
  assert.equal(value("ADVISOR_MODEL"), "claude-haiku-5-5");
  assert.equal(value("ANIMA_LIVE_MODEL_BUDGET"), "150");
  // 30/10: per-client limits under a higher host-wide budget, so one script cannot empty the demo.
  assert.equal(value("ANIMA_CLIENT_SCENE_BUDGET"), "100");
  assert.equal(value("ANIMA_GLOBAL_SCENE_BUDGET"), "1500");
  assert.equal(value("ANIMA_CLIENT_SESSIONS"), "6");
  assert.equal(value("HOST"), "0.0.0.0");
  assert.match(yaml, /^\s*autoDeploy: false\s*$/m);
  const byHand = [...yaml.matchAll(/- key: (\w+)\s*\n\s*sync: false/g)].map((m) => m[1]);
  assert.deepEqual(byHand, ["ADVISOR_API_KEY", "PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"]);
  // No key value, no other provider, and no simulator switch on the host.
  assert.doesNotMatch(yaml, /sk-ant-|ANTHROPIC_API_KEY|ANIMA_SIMULATE|PAYPAL_BASE_URL/);
});

test("hosted: pages never open a session; only the page's explicit same-origin request does, once", async () => {
  const { base, surface, close } = await serve({ hosted: true, makeApp: sim, maxSessions: 50 });
  try {
    for (let i = 0; i < 60; i++) {
      const page = await fetch(`${base}/`);
      assert.equal(page.status, 200);
      assert.equal(page.headers.get("set-cookie"), null);
    }
    assert.equal(surface.sessionCount(), 0);
    assert.equal((await fetch(`${base}/api/session`, { method: "POST", headers: json, body: "{}" })).status, 403);
    assert.equal((await fetch(`${base}/api/session`)).status, 405);
    const a = await visitor(base);
    assert.equal(surface.sessionCount(), 1);
    const again = await fetch(`${base}/api/session`, { method: "POST", headers: { ...json, Origin: base, Cookie: a.cookie }, body: "{}" });
    assert.equal(((await again.json()) as any).created, false);
    assert.equal(surface.sessionCount(), 1);
  } finally { await close(); }
});

test("hosted: a full demo refuses newcomers instead of evicting a session still in use", async () => {
  const { base, surface, close } = await serve({ hosted: true, makeApp: sim, maxSessions: 2, idleEvictMs: 60_000 });
  try {
    const judge = await visitor(base);
    await visitor(base);
    for (let i = 0; i < 51; i++) {
      const r = await fetch(`${base}/api/session`, { method: "POST", headers: { ...json, Origin: base }, body: "{}" });
      assert.equal(r.status, 503);
    }
    assert.equal(surface.sessionCount(), 2);
    assert.equal((await judge.post("/api/scenes/1")).status, 200);
  } finally { await close(); }
});

test("hosted: only a session idle past the limit may make room for a newcomer", async () => {
  const { base, surface, close } = await serve({ hosted: true, makeApp: sim, maxSessions: 1, idleEvictMs: 50 });
  try {
    const first = await visitor(base);
    await new Promise((r) => setTimeout(r, 120));
    await visitor(base);
    assert.equal(surface.sessionCount(), 1);
    assert.equal((await first.post("/api/scenes/1")).status, 401);
  } finally { await close(); }
});

test("hosted: one client cannot use up the demo by opening session after session, and is told where else to look", async () => {
  // Every request of a test comes from 127.0.0.1; the client is named by a header here, as Cloudflare does on Render.
  const { clientAddress } = await import("../src/http.ts");
  const { base, close } = await serve({ hosted: true, makeApp: sim, sceneBudget: 40, globalSceneBudget: 10, clientSceneBudget: 3, clientOf: (req) => clientAddress(req) });
  const as = (ip: string) => async () => {
    const boot = await fetch(`${base}/api/session`, { method: "POST", headers: { ...json, Origin: base, "CF-Connecting-IP": ip }, body: "{}" });
    const h = { ...json, Origin: base, "CF-Connecting-IP": ip, Cookie: boot.headers.get("set-cookie")!.split(";")[0] };
    return { post: (p: string) => fetch(`${base}${p}`, { method: "POST", headers: h, body: "{}" }) };
  };
  try {
    const script = as("203.0.113.7");
    for (let i = 0; i < 3; i++) assert.equal((await (await script()).post("/api/scenes/1")).status, 200);
    const refused = await (await script()).post("/api/scenes/1");
    assert.equal(refused.status, 429);
    assert.ok(Number(refused.headers.get("retry-after")) > 0);
    const body = (await refused.json()) as any;
    assert.match(body.error, /fair share/);
    assert.match(body.error, /npm start/);
    assert.ok(body.elsewhere.video && body.elsewhere.run_locally);
    // Someone else still runs: the host-wide budget was not used up by the script.
    assert.equal((await (await as("198.51.100.20")()).post("/api/scenes/1")).status, 200);
    // An IPv6 client is one /48, not one address: rotating addresses inside it buys nothing.
    for (let i = 1; i <= 3; i++) assert.equal((await (await as(`2001:db8:5::${i}`)()).post("/api/scenes/1")).status, 200);
    assert.equal((await (await as("2001:db8:5:ffff::9")()).post("/api/scenes/1")).status, 429);
  } finally { await close(); }
});

test("hosted: past the host-wide budget, the refusal says plainly what happened and where else to see ANIMA", async () => {
  const { base, close } = await serve({ hosted: true, makeApp: sim, globalSceneBudget: 1, videoUrl: "https://video.example/anima" });
  try {
    assert.equal((await (await visitor(base)).post("/api/scenes/1")).status, 200);
    const r = await (await visitor(base)).post("/api/scenes/1");
    assert.equal(r.status, 429);
    const body = (await r.json()) as any;
    assert.match(body.error, /nothing is broken/);
    assert.match(body.error, /https:\/\/video\.example\/anima/);
    assert.equal(body.elsewhere.video, "https://video.example/anima");
  } finally { await close(); }
});

test("hosted: a client at its session cap gives up its own idlest session, never another visitor's", async () => {
  const { clientAddress } = await import("../src/http.ts");
  const { base, surface, close } = await serve({ hosted: true, makeApp: sim, maxSessions: 3, clientSessions: 2, clientOf: (req) => clientAddress(req) });
  const boot = (ip: string) => fetch(`${base}/api/session`, { method: "POST", headers: { ...json, Origin: base, "CF-Connecting-IP": ip }, body: "{}" });
  try {
    const judge = await visitor(base);
    for (let i = 0; i < 20; i++) assert.equal((await boot("203.0.113.7")).status, 200);
    assert.equal(surface.sessionCount(), 3);
    assert.equal((await judge.post("/api/scenes/1")).status, 200);
  } finally { await close(); }
});

test("the client behind Render is Cloudflare's address, else X-Forwarded-For's first entry (said), else the socket", async () => {
  const { clientAddress, clientKey } = await import("../src/http.ts");
  const req = (headers: Record<string, string>) => ({ headers, socket: { remoteAddress: "192.0.2.10" } }) as any;
  const warned: string[] = [];
  assert.equal(clientAddress(req({ "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.99" }), (m) => warned.push(m)), "203.0.113.7");
  assert.deepEqual(warned, []);
  assert.equal(clientAddress(req({ "x-forwarded-for": "198.51.100.1, 192.0.2.11" }), (m) => warned.push(m)), "198.51.100.1");
  assert.equal(warned.length, 1);
  assert.equal(clientAddress(req({})), "192.0.2.10");
  assert.equal(clientKey("::ffff:192.0.2.1"), "192.0.2.1");
  assert.equal(clientKey("2001:DB8:0005:1::1"), "2001:db8:5::/48");
  assert.equal(clientKey("2001:db8::"), "2001:db8:0::/48");
  assert.equal(clientKey("::1"), "0:0:0::/48");
});

test("a JSON body of null, a number or a string is refused plainly, without leaking an exception's text", async () => {
  const { base, close } = await serve({ hosted: true, makeApp: sim });
  try {
    const a = await visitor(base);
    for (const body of ["null", "1", "\"x\""]) {
      const r = await fetch(`${base}/api/trust/grant`, { method: "POST", headers: { ...json, Origin: base, Cookie: a.cookie }, body });
      assert.equal(r.status, 400, body);
      assert.deepEqual(await r.json(), { error: "the body must be a JSON object" });
    }
  } finally { await close(); }
});
