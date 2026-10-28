// Web server for the ANIMA screen. No framework: node:http, the JSON API and /mcp of http.ts, and the
// static files in web/. Local by default (127.0.0.1, one desk); ANIMA_HOSTED=1 serves a hosted demo
// with a session per visitor (see http.ts), behind HTTPS set by the host.

import { createServer } from "node:http";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { AnimaApp } from "./app.ts";
import { hostedConfig, loadConfig, redact } from "./config.ts";
import { createAnimaHandler, parseLimit, resolvePublicOrigin, startupProblem } from "./http.ts";

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
let limits: { maxSessions: number; sceneBudget: number; globalSceneBudget: number };
try {
  limits = {
    maxSessions: parseLimit("ANIMA_MAX_SESSIONS", process.env.ANIMA_MAX_SESSIONS, 50, 1),
    sceneBudget: parseLimit("ANIMA_SCENE_BUDGET", process.env.ANIMA_SCENE_BUDGET, 40),
    globalSceneBudget: parseLimit("ANIMA_GLOBAL_SCENE_BUDGET", process.env.ANIMA_GLOBAL_SCENE_BUDGET, 200),
  };
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
const visitorConfig = hostedConfig(config, process.env);

// On the real sandbox the local desk's sealed ledger lives on disk next to the project (git-ignored):
// PayPal remembers every payment, so the desk must too. Hosted visitors get in-memory demo ledgers.
const ledgerFile = isAbsolute(config.ledgerPath) ? config.ledgerPath : fileURLToPath(new URL(`../${config.ledgerPath}`, import.meta.url));
const surface = hosted
  ? createAnimaHandler({ hosted, port, webDir: WEB, publicOrigin,
      makeApp: () => new AnimaApp(visitorConfig, { returnUrl, sharedPayPal: true }), ...limits })
  : createAnimaHandler({ hosted, port, webDir: WEB, app: new AnimaApp({ ...config, ledgerPath: ledgerFile }, { returnUrl, persist: Boolean(config.paypal) }) });

createServer((req, res) => void surface.handler(req, res)).listen(port, host, () => {
  console.log(`ANIMA on http://${host}:${port}${hosted ? ` (hosted: a session per visitor, ${publicOrigin ?? "loopback only"})` : ""}`, redact(hosted ? visitorConfig : config));
});
