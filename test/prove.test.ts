// "Don't trust us, break it". Chaos PayPal seals each failure as what it was, counts no money on an error,
// never touches the session's own desk or ledger; and the browser's verifier (web/prove.js) gives the same
// answer as verifyChain for every attack the page offers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createContext, runInContext } from "node:vm";
import { readFileSync } from "node:fs";
import { AnimaApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { createAnimaHandler } from "../src/http.ts";
import { ChaosLab, MAX_ASKS, proveApi } from "../src/prove.ts";
import { verifyChain } from "../src/seal.ts";

const ctx = createContext({ crypto: globalThis.crypto, TextEncoder, atob, btoa });
runInContext(readFileSync(new URL("../web/prove.js", import.meta.url), "utf8"), ctx);
const P = (ctx as any).animaProve;
const subtle = globalThis.crypto.subtle;

const EXPECT = {
  not_sent: { code: "TOOL_NOT_SENT_BY_PAYPAL_TOOLS", status: "FAILED", moved: false },
  no_answer: { code: "TOOL_OUTCOME_UNKNOWN", status: "PARTIAL", moved: false },
  refused: { code: "TOOL_FAILED_AT_PAYPAL", status: "FAILED", moved: false },
  ok: { code: "TOOL_DONE", status: "COMPLETED", moved: true },
} as const;

test("each chaos case is sealed as what happened, on the simulated tools, and no error counts money", async () => {
  const lab = new ChaosLab();
  for (const [fault, want] of Object.entries(EXPECT)) {
    const held = await lab.ask();
    assert.equal(held.tool, "create_refund");
    const r = await lab.release(held.call_id, fault as keyof typeof EXPECT, "a judge");
    assert.equal(r.explanation_code, want.code, fault);
    assert.equal(r.status, want.status, fault);
    assert.equal(r.money_moved, want.moved, fault);
    assert.equal(r.provider, "paypal-sandbox-mcp-simulator");
    assert.equal(r.release?.by, "a judge");
  }
  const { entries, publicKeyPem, head } = lab.sealed();
  assert.equal(entries.length, 4);
  assert.equal(verifyChain(entries, publicKeyPem, { head }).ok, true);
  await assert.rejects(lab.release("call-00000000-0000-0000-0000-000000000000", "ok", "a judge"), /no held refund/);
  lab.close();
});

test("a lab stops after its refunds, and an unknown fault is refused before anything runs", async () => {
  const lab = new ChaosLab();
  const held = await lab.ask();
  await assert.rejects(lab.release(held.call_id, "explode" as any, "a judge"), /unknown fault/);
  for (let i = 1; i < MAX_ASKS; i++) await lab.ask();
  await assert.rejects(lab.ask(), /reset it/);
  assert.equal(lab.ledger.sealedEntries().length, 0);
  lab.close();
});

test("chaos never reaches the session's desk: its ledger, receipts and tool budget stay as they were", async () => {
  const app = new AnimaApp(loadConfig({}, "missing.env"));
  await app.runScene(3);
  const before = app.sealedLedger().entries.length;
  const [, asked] = (await proveApi(app, "POST", "/api/prove/chaos/ask", {}, "a judge"))! as [number, any];
  const [status, out] = (await proveApi(app, "POST", "/api/prove/chaos/release", { call_id: asked.asked.call_id, fault: "ok" }, "a judge"))! as [number, any];
  assert.equal(status, 200);
  assert.equal(out.receipt.explanation_code, "TOOL_DONE");
  assert.equal(app.sealedLedger().entries.length, before);
  assert.deepEqual(app.state().tool_receipts, []);
  const [, ledgers] = (await proveApi(app, "GET", "/api/prove/ledgers", {}, "a judge"))! as [number, any];
  assert.equal(ledgers.session.entries.length, before);
  assert.equal(ledgers.chaos.entries.length, 1);
  assert.notEqual(ledgers.chaos.head.key_id, ledgers.session.head.key_id);
  assert.equal(await proveApi(app, "GET", "/api/ledger", {}, "a judge"), null);
  app.close();
});

test("hosted: the prove routes need the visitor's session and a same-origin JSON write", async () => {
  const origin = "https://anima.example";
  const h = createAnimaHandler({ hosted: true, port: 0, webDir: "web", publicOrigin: origin, makeApp: () => new AnimaApp(loadConfig({}, "missing.env")) });
  const server = (await import("node:http")).createServer(h.handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const headers = { "Content-Type": "application/json", Origin: origin };
  try {
    assert.equal((await fetch(`${base}/api/prove/ledgers`)).status, 401);
    const opened = await fetch(`${base}/api/session`, { method: "POST", headers, body: "{}" });
    const cookie = opened.headers.get("set-cookie")!.split(";")[0];
    assert.equal((await fetch(`${base}/api/prove/chaos/ask`, { method: "POST", headers: { ...headers, Cookie: cookie, Origin: "https://evil.example" }, body: "{}" })).status, 403);
    const ask = await (await fetch(`${base}/api/prove/chaos/ask`, { method: "POST", headers: { ...headers, Cookie: cookie }, body: "{}" })).json();
    const rel = await (await fetch(`${base}/api/prove/chaos/release`, { method: "POST", headers: { ...headers, Cookie: cookie }, body: JSON.stringify({ call_id: ask.asked.call_id, fault: "no_answer" }) })).json();
    assert.equal(rel.receipt.explanation_code, "TOOL_OUTCOME_UNKNOWN");
    assert.match(rel.receipt.release.by, /^demo visitor /);
  } finally {
    server.close();
    h.close();
  }
});

test("the browser's verifier answers as verifyChain for every attack the page offers", async () => {
  const lab = new ChaosLab();
  for (const fault of ["not_sent", "no_answer", "refused", "ok"] as const) {
    const held = await lab.ask();
    await lab.release(held.call_id, fault, "a judge");
  }
  const { entries, publicKeyPem, head } = lab.sealed();
  const keyId = head.key_id;
  const copy = () => JSON.parse(JSON.stringify(entries));
  const both = async (es: any[], pem = publicKeyPem, hd: any = head) => {
    const node = verifyChain(es, pem, { head: hd, keyId });
    const web = JSON.parse(JSON.stringify(await P.verify(subtle, es, pem, { head: hd, keyId })));
    assert.equal(web.signatures, true);
    assert.deepEqual(JSON.parse(JSON.stringify({ ok: web.ok, checked: web.checked, broken: web.broken, anchor: web.anchor })), JSON.parse(JSON.stringify({ ok: node.ok, checked: node.checked, broken: node.broken, anchor: node.anchor })));
    return node;
  };
  assert.equal(P.canonical({ b: 1, a: { d: [1, { y: 2, x: 1 }] } }), '{"a":{"d":[1,{"x":1,"y":2}]},"b":1}');
  assert.equal((await both(entries)).ok, true);

  const cent = copy();
  assert.ok(P.addCent(cent[3]));
  assert.deepEqual((await both(cent)).broken, { index: 3, reason: "HASH" });

  const word = copy();
  const changed = P.changeWord(word[1]);
  assert.match(changed.was, /^Unknown/);
  assert.match(changed.now, /^Done\./);
  assert.deepEqual((await both(word)).broken, { index: 1, reason: "HASH" });

  const removed = copy();
  removed.splice(1, 1);
  assert.deepEqual((await both(removed)).broken, { index: 1, reason: "ORDER" });

  const cut = copy().slice(0, -1);
  assert.deepEqual((await both(cut)).broken, { index: 3, reason: "TRUNCATED" });

  const forged = await P.forge(subtle, cent);
  assert.equal(verifyChain(forged.entries, forged.publicKeyPem, { head: forged.head }).ok, true, "the forgery holds against its own key");
  assert.deepEqual((await both(forged.entries, forged.publicKeyPem, forged.head)).broken, { index: 0, reason: "KEY" });
  lab.close();
});

test("hand-edited seals, entries and heads get the same verdict in the browser and in Node, never a crash", async () => {
  const lab = new ChaosLab();
  for (const fault of ["no_answer", "ok"] as const) {
    const held = await lab.ask();
    await lab.release(held.call_id, fault, "a judge");
  }
  const { entries, publicKeyPem, head } = lab.sealed();
  const keyId = head.key_id;
  const copy = () => JSON.parse(JSON.stringify(entries));
  const cases: [string, any[], any][] = [];
  const lenient = copy(); lenient[1].seal.sig += "!!"; cases.push(["lenient base64 signature", lenient, head]);
  const url = copy(); url[0].seal.sig = url[0].seal.sig.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); cases.push(["base64url signature", url, head]);
  const nosig = copy(); delete nosig[0].seal.sig; cases.push(["signature deleted", nosig, head]);
  const nul = copy(); nul[1] = null; cases.push(["entry replaced by null", nul, head]);
  const noseal = copy(); noseal[0].seal = "x"; cases.push(["seal not an object", noseal, head]);
  cases.push(["head null", copy(), null]);
  cases.push(["head signature lenient", copy(), { ...head, sig: head.sig + "!!" }]);
  for (const [name, es, hd] of cases) {
    const node = verifyChain(es, publicKeyPem, { head: hd, keyId });
    const web = JSON.parse(JSON.stringify(await P.verify(subtle, es, publicKeyPem, { head: hd, keyId })));
    assert.equal(node.ok, false, name);
    assert.deepEqual(web.broken, node.broken, name);
  }
  lab.close();
});

test("the pinned fingerprint is the key's, however its PEM text was saved", async () => {
  const lab = new ChaosLab();
  const { entries, publicKeyPem, head } = lab.sealed();
  for (const pem of [publicKeyPem.replace(/\n/g, "\r\n"), publicKeyPem.trimEnd(), `junk before\n${publicKeyPem}`]) {
    assert.equal(verifyChain(entries, pem, { head, keyId: head.key_id }).ok, true);
    assert.equal(await P.fingerprintOf(subtle, pem), head.key_id);
  }
  assert.equal(head.key_id.length, 64);
  lab.close();
});

test("a simulated failure says so in the sealed text, not only in the provider field", async () => {
  const lab = new ChaosLab();
  for (const fault of ["not_sent", "no_answer"] as const) {
    const held = await lab.ask();
    const r = await lab.release(held.call_id, fault, "a judge");
    assert.match(r.explanation, /simulated PayPal/, fault);
    assert.ok(r.findings.some((f) => /simulated PayPal/.test(f.message)), fault);
  }
  lab.close();
});
