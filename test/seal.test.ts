// Sealed receipts: the chain verifies as written, and any alteration, removal, reordering or
// foreign key is caught at the exact entry where it happened.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AnimaApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { Ledger } from "../src/ledger.ts";
import { Signer, canonical, verifyChain } from "../src/seal.ts";

async function playAll(a: AnimaApp) {
  for (const n of [1, 2, 3, 4]) {
    const run = await a.runScene(n);
    if (run.outcome !== "awaiting_payer") continue;
    a.approveAsPayer(run.pending_key!);
    if (n === 2) await a.decline(run.pending_key!, "Studio Lumen", "declined after review");
    else {
      const paid = await a.release(run.pending_key!, "Studio Lumen");
      if (n === 4) a.goldenSeam(paid.receipt_id, "Studio Lumen");
    }
  }
}

test("canonical form ignores key order", () => {
  assert.equal(canonical({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: "z" } }), canonical({ a: { c: "z", d: [1, { x: 1, y: 2 }] }, b: 1 }));
});

test("the four scenes leave a chain that verifies, correction included", async () => {
  const a = new AnimaApp(loadConfig({}, "missing.env"));
  await playAll(a);
  const v = a.verifyLedger();
  assert.equal(v.ok, true);
  assert.equal(v.checked, 5);
});

test("tampering is caught where it happened: amount, removal, reorder, foreign key", async () => {
  const a = new AnimaApp(loadConfig({}, "missing.env"));
  await playAll(a);
  const { entries, publicKeyPem } = a.sealedLedger();
  const copy = () => JSON.parse(JSON.stringify(entries));

  const altered = copy();
  altered[1].request.amount_cents = 1;
  assert.deepEqual(verifyChain(altered, publicKeyPem).broken, { index: 1, reason: "HASH" });

  const removed = copy();
  removed.splice(2, 1);
  assert.equal(verifyChain(removed, publicKeyPem).broken?.index, 2);

  const swapped = copy();
  [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
  assert.equal(verifyChain(swapped, publicKeyPem).ok, false);

  const forger = Signer.load(null);
  assert.deepEqual(verifyChain(entries, forger.publicKeyPem).broken, { index: 0, reason: "SIGNATURE" });
});

test("a persistent ledger keeps its key and its chain across restarts", () => {
  const dir = mkdtempSync(join(tmpdir(), "anima-"));
  const path = join(dir, "receipts.jsonl");
  const first = new Ledger(path);
  const receipt = { schema: "anima.payment_receipt.v0", receipt_id: "r1", corrections: [], explanation: "x" } as any;
  first.append(receipt);
  const second = new Ledger(path);
  second.append({ ...receipt, receipt_id: "r2" });
  assert.equal(second.verify().ok, true);
  assert.equal(second.sealedEntries().length, 2);
  assert.equal(second.publicKeyPem, first.publicKeyPem);
  const lines = readFileSync(path, "utf8").trim().split("\n");
  const doctored = JSON.parse(lines[0]);
  doctored.explanation = "rewritten";
  writeFileSync(path, [JSON.stringify(doctored), lines[1]].join("\n") + "\n");
  // Fail closed: a doctored ledger is refused at load, naming the broken entry; nothing in it is trusted.
  assert.throws(() => new Ledger(path), /fails verification at entry 0 \(HASH\); refusing to use it/);
});
