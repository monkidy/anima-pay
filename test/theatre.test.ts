// The decision theatre must not merge two facts (Asso's reread of 37639b2, #3199/6374572054): whether the
// mandate allowed the payment, and whether the gate refused it. An invoice already paid is refused while the
// mandate stays valid; a payee, amount or currency differing from the invoice is a real breach of the mandate.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { AnimaApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";

const ctx = createContext({});
runInContext(readFileSync(new URL("../web/theatre.js", import.meta.url), "utf8"), ctx);
const { theatreFacts } = (ctx as any).animaTheatre;
const rail = (f: any) => Object.fromEntries(Array.from(f.rail, ([k, s]: [string, string]) => [k, s]));
const failIds = (r: any) => r.findings.filter((f: any) => f.impact === "fail").map((f: any) => f.id);

test("an invoice already paid: the gate refuses, the mandate stays valid, the payer is not asked", async () => {
  const app = new AnimaApp(loadConfig({}, "missing.env"));
  try {
    const first = await app.runScene(1);
    app.approveAsPayer(first.pending_key!);
    assert.equal((await app.release(first.pending_key!, "Studio Lumen", [])).status, "COMPLETED");

    const again = await app.runScene(1);
    assert.equal(again.outcome, "refused");
    assert.deepEqual(failIds(again.receipt), ["INVOICE_ALREADY_PAID"]);
    const f = theatreFacts(again, again.receipt, null);
    assert.equal(f.verdict, "fail");
    assert.equal(f.mandateValid, true);
    assert.equal(f.locks.mandate, "open");
    assert.equal(rail(f).mandate, "ok", "the rail's mandate step reads the same truth as the mandate's lock");
    assert.equal(rail(f).gate, "stop");
    assert.equal(rail(f).payer, "skip");
    assert.equal(f.locks.payer, "unasked");
  } finally { app.close(); }
});

test("a real breach of the mandate: the mandate's lock shuts and the rail stops at the mandate and the gate", async () => {
  const app = new AnimaApp(loadConfig({}, "missing.env"));
  try {
    const run = await app.runScene(3);
    assert.equal(run.outcome, "refused");
    assert.ok(failIds(run.receipt).includes("PROPOSAL_DOES_NOT_MATCH_INVOICE"));
    const f = theatreFacts(run, run.receipt, null);
    assert.equal(f.mandateValid, false);
    assert.equal(f.locks.mandate, "shut");
    assert.equal(rail(f).mandate, "stop");
    assert.equal(rail(f).gate, "stop");
    assert.equal(f.locks.payer, "unasked");
  } finally { app.close(); }
});

test("a payment that passed the gate: mandate and gate open, the payer is waited for", async () => {
  const app = new AnimaApp(loadConfig({}, "missing.env"));
  try {
    const run = await app.runScene(1);
    assert.notEqual(run.outcome, "refused");
    const pending = app.state().pending.find((p: any) => p.key === run.pending_key);
    const f = theatreFacts(run, undefined, pending);
    assert.equal(f.locks.mandate, "open");
    assert.equal(rail(f).mandate, "ok");
    assert.equal(rail(f).gate, "ok");
    assert.equal(rail(f).payer, "wait");
    assert.equal(f.locks.payer, "closed");
  } finally { app.close(); }
});
