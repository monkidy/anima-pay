// Web server for the ANIMA screen. No framework: node:http, the JSON API and /mcp of http.ts, and the
// static files in web/. Local by default (127.0.0.1, one desk); ANIMA_HOSTED=1 serves a hosted demo
// with a session per visitor (see http.ts), behind HTTPS set by the host.

import { createServer } from "node:http";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { AnimaApp, rollingBudget } from "./app.ts";
import { hostedConfig, loadConfig, redact } from "./config.ts";
import { clientAddress, createAnimaHandler, parseLimit, resolvePublicOrigin, startupProblem } from "./http.ts";

// A promise rejected with nobody to observe it would stop Node, and with it every visitor's session. It is
// logged, loudly and with its stack, and the server goes on. This hides nothing on the money path: every
// payment's own steps are awaited by the request that runs them, so their failures reach the person as an
// error or a sealed receipt, never this handler.
process.on("unhandledRejection", (reason) => {
  console.error("ANIMA unhandled rejection (logged; the server goes on):", reason instanceof Error ? reason.stack : reason);
});

const host = process.env.HOST || "127.0.0.1";
// ANIMA_PUBLIC_ORIGIN, or on Render the service's own address (RENDER_EXTERNAL_URL).
const publicOrigin = resolvePublicOrigin(process.env);
// Fail closed, before any desk exists or any port opens: a non-loopback interface needs ANIMA_HOSTED=1
// exactly, and the hosted mode an exact https origin (Secure cookie).
const problem = startupProblem({ host, hosted: process.env.ANIMA_HOSTED, publicOrigin });
if (problem) {
  console.error(problem);
  process.exit(1);
}
const hosted = process.env.ANIMA_HOSTED === "1";
// Per session, per client (one address, or one IPv6 /48) and host-wide. The host-wide budget protects the
// PayPal sandbox app and the model; the per-client limits keep one script from using it up for everyone.
let limits: { maxSessions: number; sceneBudget: number; globalSceneBudget: number; clientSceneBudget: number; clientSessions: number };
let liveModelRuns: number;
let videoUrl: string | undefined;
try {
  limits = {
    maxSessions: parseLimit("ANIMA_MAX_SESSIONS", process.env.ANIMA_MAX_SESSIONS, 100, 1),
    sceneBudget: parseLimit("ANIMA_SCENE_BUDGET", process.env.ANIMA_SCENE_BUDGET, 40),
    globalSceneBudget: parseLimit("ANIMA_GLOBAL_SCENE_BUDGET", process.env.ANIMA_GLOBAL_SCENE_BUDGET, 1500),
    clientSceneBudget: parseLimit("ANIMA_CLIENT_SCENE_BUDGET", process.env.ANIMA_CLIENT_SCENE_BUDGET, 100),
    clientSessions: parseLimit("ANIMA_CLIENT_SESSIONS", process.env.ANIMA_CLIENT_SESSIONS, 6, 1),
  };
  liveModelRuns = parseLimit("ANIMA_LIVE_MODEL_BUDGET", process.env.ANIMA_LIVE_MODEL_BUDGET, 150);
  // Named to visitors when the demo can take no more runs: an exact https address, or nothing.
  videoUrl = process.env.ANIMA_VIDEO_URL || undefined;
  if (videoUrl && new URL(videoUrl).protocol !== "https:") throw new Error(`ANIMA_VIDEO_URL must be https (got ${videoUrl}); refusing to start`);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
if (hosted && process.env.ANIMA_PUBLIC_ORIGIN && process.env.RENDER_EXTERNAL_URL && process.env.ANIMA_PUBLIC_ORIGIN !== process.env.RENDER_EXTERNAL_URL.replace(/\/+$/, "")) {
  console.warn(`ANIMA_PUBLIC_ORIGIN (${process.env.ANIMA_PUBLIC_ORIGIN}) is not this service's Render address (${process.env.RENDER_EXTERNAL_URL}): pages opened at the Render address will be refused; that is right only for a custom domain`);
}
const WEB = fileURLToPath(new URL("../web/", import.meta.url));
const config = loadConfig(process.env, fileURLToPath(new URL("../.env", import.meta.url)));
const port = Number(process.env.PORT || 5274);
const returnUrl = `${publicOrigin ?? `http://127.0.0.1:${port}`}/`;
// A hosted demo answers with scripted advice unless the host opts in to a real model, whose runs are then
// bounded per session and across all sessions. That global budget lives in process memory: a restart
// resets it, so it is not a durable credit cap; a hosted real model needs a provider-side cap too.
// Past its own daily budget, or when the provider fails, a run falls back to the script and says so.
// Likewise scene 7: when PayPal's tool server fails before sending a call to PayPal, it goes on with the
// simulated tools and says so (AnimaApp's toolsFallback).
const visitorConfig = hostedConfig(config, process.env);
const liveFallback = rollingBudget(liveModelRuns);

// On the real sandbox the local desk's sealed ledger lives on disk next to the project (git-ignored):
// PayPal remembers every payment, so the desk must too. Hosted visitors get in-memory demo ledgers.
// Who is asking: on Render, the address Cloudflare saw (see clientAddress); elsewhere, the socket's.
let warned = false;
const clientOf = process.env.RENDER ? (req: Parameters<typeof clientAddress>[0]) => clientAddress(req, (msg) => { if (!warned) { warned = true; console.warn(msg); } }) : undefined;
const ledgerFile = isAbsolute(config.ledgerPath) ? config.ledgerPath : fileURLToPath(new URL(`../${config.ledgerPath}`, import.meta.url));
const surface = hosted
  ? createAnimaHandler({ hosted, port, webDir: WEB, publicOrigin,
      makeApp: () => new AnimaApp(visitorConfig, { returnUrl, sharedPayPal: true, liveFallback, toolsFallback: true }), ...limits, clientOf, videoUrl })
  : createAnimaHandler({ hosted, port, webDir: WEB, app: new AnimaApp({ ...config, ledgerPath: ledgerFile }, { returnUrl, persist: Boolean(config.paypal) }) });

createServer((req, res) => void surface.handler(req, res)).listen(port, host, () => {
  console.log(`ANIMA on http://${host}:${port}${hosted ? ` (hosted: a session per visitor, ${publicOrigin ?? "loopback only"})` : ""}`, redact(hosted ? visitorConfig : config));
});
