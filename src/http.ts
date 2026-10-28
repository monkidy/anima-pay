// The desk's HTTP surface, for the local screen and for a hosted demo.
//
// Local (default): one desk for its operator on the same machine. No other web page may act on it: a
// request carrying another site's Origin is refused, and writes must be JSON (cross-site request forgery
// against a local service is a real attack, even on 127.0.0.1).
//
// Hosted (ANIMA_HOSTED=1): every visitor gets a session of their own (an HttpOnly, SameSite=Strict
// cookie) and an in-memory desk of their own. Pages and files never open one: the page asks for it
// explicitly (POST /api/session, same origin), and a full demo refuses newcomers rather than evicting
// a session still in use, so crawlers and replays cannot push a judge out. The person who releases, grants or declines is named by
// the server, never by the request; nobody can see, release or reset another visitor's payments; runs
// that may call a model or PayPal (scenes, and an agent's tool calls) are bounded per session and
// host-wide; agents reach /mcp only with their session's token.
//
// Allowed origins are fixed at start (the public origin, or the loopback addresses), never read from a
// request's Host header; without a public origin the desk also answers only to a loopback Host, so a
// page that rebinds its own name to 127.0.0.1 can neither write nor read.

import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join } from "node:path";
import type { AnimaApp } from "./app.ts";
import { handleMcp } from "./mcp-server.ts";

const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" };
const MAX_BODY = 32 * 1024;
const COOKIE = "anima_sid";

export interface HttpOptions {
  hosted: boolean;
  port: number;
  webDir: string;
  /** Local mode: the single desk. */
  app?: AnimaApp;
  /** Hosted mode: a fresh desk for each visitor. */
  makeApp?: () => AnimaApp;
  /** Hosted mode: the public origin (https://…) browsers will send; defaults to the Host header's. */
  publicOrigin?: string;
  maxSessions?: number;
  sceneBudget?: number;
  /** Hosted mode: runs allowed across ALL sessions in any 24 hours; new sessions cannot reset it. */
  globalSceneBudget?: number;
  sessionTtlMs?: number;
  /** A full demo may evict a session only after this long without activity (default 15 minutes). */
  idleEvictMs?: number;
  /** Defaults to true when publicOrigin is https. */
  secureCookie?: boolean;
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

/**
 * Why hosted mode must not start, or null. On anything but the loopback interface it needs an exact
 * https origin: browsers then send that Origin, and the session cookie is Secure. Without it, the cookie
 * would travel in clear and allowed origins would come from a Host header an attacker can set.
 */
export function hostedStartupProblem(o: { host: string; publicOrigin?: string }): string | null {
  if (LOOPBACK.has(o.host)) return null;
  if (!o.publicOrigin) return `hosted mode on ${o.host} needs ANIMA_PUBLIC_ORIGIN=https://… (on Render, RENDER_EXTERNAL_URL serves); refusing to start`;
  let url: URL;
  try { url = new URL(o.publicOrigin); } catch { return `ANIMA_PUBLIC_ORIGIN is not a URL: ${o.publicOrigin}; refusing to start`; }
  if (url.protocol !== "https:") return `ANIMA_PUBLIC_ORIGIN must be https (got ${url.protocol}); refusing to start`;
  if (url.origin !== o.publicOrigin) return `ANIMA_PUBLIC_ORIGIN must be an origin without path or slash (${url.origin}); refusing to start`;
  return null;
}

/**
 * Why the server must not start, or null. Checked before any desk is created or any port is opened.
 * The local mode trusts whoever reaches it, which is only true on loopback: listening on any other
 * interface requires ANIMA_HOSTED to be exactly "1" (absent, "0", "true" or a typo all refuse), and the
 * hosted mode then needs its exact https origin.
 */
export function startupProblem(o: { host: string; hosted?: string; publicOrigin?: string }): string | null {
  if (!LOOPBACK.has(o.host) && o.hosted !== "1") {
    return `HOST=${o.host} is not loopback: ANIMA_HOSTED must be exactly 1 there (got ${o.hosted === undefined ? "unset" : JSON.stringify(o.hosted)}); refusing to start`;
  }
  return o.hosted === "1" ? hostedStartupProblem(o) : null;
}

/**
 * A limit from the environment: the fallback when unset, else a whole number at least `min`. Anything else
 * throws, so the server refuses to start: Number("4O") is NaN, and every comparison with NaN is false, so a
 * typo would otherwise switch the budget off.
 */
export function parseLimit(name: string, raw: string | undefined, fallback: number, min = 0): number {
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/.test(raw.trim()) || Number(raw) < min) throw new Error(`${name} must be a whole number of at least ${min} (got ${JSON.stringify(raw)}); refusing to start`);
  return Number(raw);
}

/**
 * The hosted demo's public origin: ANIMA_PUBLIC_ORIGIN when set (a custom domain), otherwise the address
 * Render gives the service (RENDER_EXTERNAL_URL), reduced to its origin. Either is then held to
 * hostedStartupProblem's rules; a value that is not a URL is passed on as is, to be refused there.
 */
export function resolvePublicOrigin(env: Record<string, string | undefined>): string | undefined {
  if (env.ANIMA_PUBLIC_ORIGIN) return env.ANIMA_PUBLIC_ORIGIN;
  if (env.ANIMA_HOSTED !== "1" || !env.RENDER_EXTERNAL_URL) return undefined;
  try { return new URL(env.RENDER_EXTERNAL_URL).origin; } catch { return env.RENDER_EXTERNAL_URL; }
}

/**
 * The page loads itself, and from jsDelivr only the exact AG Grid build and the three font packages it
 * names (a bare jsDelivr host would let any npm package or GitHub file run here). Inline styles stay
 * allowed: the theatre times its beats with style attributes. Nothing may frame the page.
 */
const CDN = "https://cdn.jsdelivr.net/npm";
const AG_GRID = `${CDN}/ag-grid-community@32.3.3/`;
const FONTS = [`${CDN}/@fontsource-variable/fraunces@5.2.9/`, `${CDN}/@fontsource-variable/inter@5.2.8/`, `${CDN}/@fontsource/ibm-plex-mono@5.2.7/`];
export const CSP = [
  "default-src 'self'",
  `script-src 'self' ${AG_GRID}dist/ag-grid-community.min.js`,
  `style-src 'self' 'unsafe-inline' ${AG_GRID}styles/ ${FONTS.join(" ")}`,
  "img-src 'self' data:",
  `font-src 'self' data: ${FONTS.join(" ")}`,
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");
/** JSON is never a page: it may load nothing and be framed by nothing. */
const API_HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'" };

interface Session { id: string; app: AnimaApp; principal: string; mcpToken: string; scenes: number; seen: number }

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...API_HEADERS, ...headers });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<any> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, "request body too large");
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  try { return text ? JSON.parse(text) : {}; } catch { throw new HttpError(400, "the body is not JSON"); }
}

const token = () => randomBytes(24).toString("base64url");

export function createAnimaHandler(o: HttpOptions) {
  if (o.hosted ? !o.makeApp : !o.app) throw new Error(o.hosted ? "hosted mode needs makeApp" : "local mode needs app");
  const sessions = new Map<string, Session>();
  const byToken = new Map<string, Session>();
  const maxSessions = o.maxSessions ?? 50;
  const sceneBudget = o.sceneBudget ?? 40;
  const globalBudget = o.globalSceneBudget ?? 200;
  const runsLastDay: number[] = [];
  const secureCookie = o.secureCookie ?? Boolean(o.publicOrigin?.startsWith("https://"));
  const ttl = o.sessionTtlMs ?? 2 * 3_600_000;
  const idleEvict = o.idleEvictMs ?? 15 * 60_000;
  // Fixed at start, never read from a request: the public origin, or else the loopback addresses.
  const allowedOrigins = new Set(o.publicOrigin ? [o.publicOrigin] : [`http://127.0.0.1:${o.port}`, `http://localhost:${o.port}`, `http://[::1]:${o.port}`]);
  const loopbackHosts = new Set([`127.0.0.1:${o.port}`, `localhost:${o.port}`, `[::1]:${o.port}`]);

  /** One run that may call a model or PayPal, for this session and for the whole host; refused past either budget. */
  function spend(s: Session, runs: number): void {
    if (runs <= 0) return;
    if (s.scenes + runs > sceneBudget) throw new HttpError(429, `this demo session has used its ${sceneBudget} runs`);
    // Host-wide: opening new sessions does not buy new runs.
    const now = Date.now();
    while (runsLastDay.length && now - runsLastDay[0] > 86_400_000) runsLastDay.shift();
    if (runsLastDay.length + runs > globalBudget) throw new HttpError(429, `the demo has used its ${globalBudget} runs for the last 24 hours; try again later`);
    for (let i = 0; i < runs; i++) runsLastDay.push(now);
    s.scenes += runs;
  }

  function drop(s: Session): void {
    sessions.delete(s.id);
    byToken.delete(s.mcpToken);
    s.app.close();
  }

  function sweep(now: number): void {
    for (const s of sessions.values()) if (now - s.seen > ttl) drop(s);
  }

  function newSession(): Session {
    if (sessions.size >= maxSessions) {
      const idlest = [...sessions.values()].sort((a, b) => a.seen - b.seen)[0];
      if (Date.now() - idlest.seen < idleEvict) throw new HttpError(503, "the demo is full right now; try again in a few minutes");
      drop(idlest);
    }
    const s: Session = { id: token(), app: o.makeApp!(), principal: "", mcpToken: token(), scenes: 0, seen: Date.now() };
    s.principal = `demo visitor ${s.id.slice(0, 6)}`;
    sessions.set(s.id, s);
    byToken.set(s.mcpToken, s);
    return s;
  }

  function sessionOf(req: IncomingMessage): Session | null {
    const raw = req.headers.cookie ?? "";
    const id = raw.split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    const s = id ? sessions.get(id) : undefined;
    if (!s) return null;
    s.seen = Date.now();
    return s;
  }

  function cookieFor(s: Session): string {
    return `${COOKIE}=${s.id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(ttl / 1000)}${secureCookie ? "; Secure" : ""}`;
  }

  /** The origins a browser may send for this desk; any other site is refused. */
  function originOk(req: IncomingMessage): boolean {
    const origin = req.headers.origin;
    if (!origin) return !o.hosted; // scripts on the same machine send none; a hosted write must come from the page
    return allowedOrigins.has(origin);
  }

  async function api(req: IncomingMessage, path: string, app: AnimaApp, s: Session | null): Promise<[number, unknown]> {
    const method = req.method ?? "GET";
    let m: RegExpMatchArray | null;
    if (method === "POST") {
      if (!originOk(req)) throw new HttpError(403, "this request comes from another site; refused");
      if (!(req.headers["content-type"] ?? "").startsWith("application/json")) throw new HttpError(415, "writes must be JSON");
    }
    const b = method === "POST" ? await readBody(req) : {};
    // Hosted: the server names the person; whatever the request says about who it is, is ignored.
    const by = s ? s.principal : String(b.by || "the account owner");
    const acks = Array.isArray(b.acknowledged) ? b.acknowledged.map(String) : [];
    // A local desk has one person and no session to open: the page's bootstrap is a no-op here.
    if (method === "POST" && path === "/api/session") return [200, { principal: by, created: false }];
    if (method === "GET" && path === "/api/state") return [200, s ? { ...app.state(), session: { principal: s.principal, mcp_token: s.mcpToken, scenes_left: sceneBudget - s.scenes } } : app.state()];
    if (method === "GET" && path === "/api/ledger") return [200, app.sealedLedger()];
    if (method !== "POST") {
      if (m = path.match(/^\/api\/pending\/([a-f0-9]{32})\/paypal$/)) return [200, await app.payerStatus(m[1])];
      return [404, { error: "not found" }];
    }
    if (path.startsWith("/api/scenes/") && s) spend(s, 1);
    if (path === "/api/reset") { app.reset(); return [200, app.state()]; }
    if (path === "/api/trust/grant") return [200, app.grantTrust(String(b.merchant), by)];
    if (path === "/api/scenes/7") return [200, await app.runToolScene()];
    if (m = path.match(/^\/api\/scenes\/([1-6])$/)) return [200, await app.runScene(Number(m[1]))];
    if (m = path.match(/^\/api\/tools\/(call-[0-9a-f-]{36})\/release$/)) return [200, await app.toolRelease(m[1], by, acks)];
    if (m = path.match(/^\/api\/tools\/(call-[0-9a-f-]{36})\/decline$/)) return [200, app.toolDecline(m[1], by, String(b.reason || "declined"))];
    if (m = path.match(/^\/api\/pending\/([a-f0-9]{32})\/test-payer$/)) return [200, await app.standInTestPayer(m[1])];
    if (m = path.match(/^\/api\/pending\/([a-f0-9]{32})\/approve$/)) { app.approveAsPayer(m[1]); return [200, { ok: true }]; }
    if (m = path.match(/^\/api\/pending\/([a-f0-9]{32})\/release$/)) return [200, await app.release(m[1], s ? by : b.by, acks)];
    if (m = path.match(/^\/api\/pending\/([a-f0-9]{32})\/decline$/)) return [200, await app.decline(m[1], by, String(b.reason || "declined"))];
    if (m = path.match(/^\/api\/receipts\/([0-9a-f-]{36})\/seam$/)) return [200, app.goldenSeam(m[1], by)];
    return [404, { error: "not found" }];
  }

  /** The page's explicit, same-origin request for a session: exactly one per visitor, never by a GET. */
  async function bootstrap(req: IncomingMessage, res: ServerResponse, existing: Session | null): Promise<void> {
    if (req.method !== "POST") throw new HttpError(405, "POST only");
    if (!originOk(req)) throw new HttpError(403, "this request comes from another site; refused");
    if (!(req.headers["content-type"] ?? "").startsWith("application/json")) throw new HttpError(415, "writes must be JSON");
    if (existing) return send(res, 200, { principal: existing.principal, created: false });
    const s = newSession();
    send(res, 200, { principal: s.principal, created: true }, { "Set-Cookie": cookieFor(s) });
  }

  async function mcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let app = o.app;
    let s: Session | undefined;
    if (o.hosted) {
      const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
      s = bearer ? byToken.get(bearer) : undefined;
      if (!s) return send(res, 401, { error: "an agent needs its session's token (Authorization: Bearer …)" }, { "WWW-Authenticate": "Bearer" });
      s.seen = Date.now();
      app = s.app;
    } else if (!originOk(req)) return send(res, 403, { error: "origin not allowed" });
    if (req.method !== "POST") { res.writeHead(405, { Allow: "POST" }); res.end(); return; }
    const msg = await readBody(req);
    // Hosted: every tool call may reach PayPal, so each one is a run of the session's budget.
    if (s) spend(s, (Array.isArray(msg) ? msg : [msg]).filter((x) => x?.method === "tools/call").length);
    const answers = Array.isArray(msg) ? (await Promise.all(msg.map((x) => handleMcp(app!, x)))).filter(Boolean) : [await handleMcp(app!, msg)].filter(Boolean);
    if (!answers.length) { res.writeHead(202); res.end(); return; }
    send(res, 200, Array.isArray(msg) ? answers : answers[0]);
  }

  async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      // Without a public origin the desk lives on loopback: any other Host is a rebound name.
      if (!o.publicOrigin && !loopbackHosts.has(req.headers.host ?? "")) return send(res, 421, { error: "this desk answers only on its loopback address" });
      if (o.hosted) sweep(Date.now());
      if (url.pathname === "/mcp") return await mcp(req, res);
      if (url.pathname.startsWith("/api/")) {
        let s: Session | null = null;
        if (o.hosted) {
          s = sessionOf(req);
          if (url.pathname === "/api/session") return await bootstrap(req, res, s);
          if (!s) return send(res, 401, { error: "no session" });
        }
        const [status, payload] = await api(req, url.pathname, s ? s.app : o.app!, s);
        return send(res, status, payload);
      }
      const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      if (!/^[a-z0-9._-]+$/i.test(file) || !TYPES[extname(file)]) return send(res, 404, { error: "not found" });
      const content = await readFile(join(o.webDir, file));
      const headers: Record<string, string> = { "Content-Type": TYPES[extname(file)], "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Content-Security-Policy": CSP };
      // Served over https: browsers must never come back over plain http.
      if (secureCookie) headers["Strict-Transport-Security"] = "max-age=31536000";
      res.writeHead(200, headers);
      res.end(content);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 400;
      send(res, status, { error: (e as Error).message });
    }
  }

  return {
    handler,
    sessionCount: () => sessions.size,
    close: () => { for (const s of [...sessions.values()]) drop(s); o.app?.close(); },
  };
}
