// A ledger cut of its last entries, or re-signed whole with another key, must not verify as intact.
// Before the signed head, both did: every entry left still chained and signed, and the key came from
// the same file as the entries.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AnimaApp } from "../src/app.ts";
import { Ledger } from "../src/ledger.ts";
import { loadConfig } from "../src/config.ts";
import { Signer, verifyChain } from "../src/seal.ts";

/** Scenes 1 to 4 played to the end on the simulated sandbox: five sealed entries, a correction included. */
async function sealedApp() {
  const app = new AnimaApp(loadConfig({}, "missing.env"));
  for (const n of [1, 2, 3, 4]) {
    const run = await app.runScene(n);
    if (run.outcome !== "awaiting_payer") continue;
    app.approveAsPayer(run.pending_key!);
    if (n === 2) await app.decline(run.pending_key!, "Studio Lumen", "declined after review");
    else {
      const paid = await app.release(run.pending_key!, "Studio Lumen");
      if (n === 4) app.goldenSeam(paid.receipt_id, "Studio Lumen");
    }
  }
  return app;
}

function verifyFile(ledger: unknown, ...args: string[]): { code: number; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "anima-anchor-"));
  const file = join(dir, "ledger.json");
  writeFileSync(file, JSON.stringify(ledger));
  try {
    return { code: 0, out: execFileSync(process.execPath, ["scripts/verify-ledger.ts", file, ...args], { encoding: "utf8" }) };
  } catch (e: any) {
    return { code: e.status, out: String(e.stdout) };
  }
}

test("a ledger cut of its last entry no longer verifies: the signed head names how many there were", async () => {
  const app = await sealedApp();
  const full = app.sealedLedger();
  assert.ok(full.entries.length >= 3);
  const cut = { ...full, entries: full.entries.slice(0, -1) };
  const { code, out } = verifyFile(cut);
  assert.equal(code, 1, out);
  assert.match(out, new RegExp(`CHAIN_BROKEN at entry ${full.entries.length - 1} \\(TRUNCATED\\)`));
  app.close();
});

test("the whole ledger re-signed with another key fails against the key fingerprint the verifier pinned", async () => {
  const app = await sealedApp();
  const { entries, publicKeyPem, head } = app.sealedLedger();
  const forger = new Ledger(null, Signer.load(null));
  for (const e of entries) { const { seal: _s, ...body } = e as any; forger.append(body); }
  const forged = { entries: forger.sealedEntries(), publicKeyPem: forger.publicKeyPem, head: forger.head() };
  // Self-consistent, so the forgery holds against its own key...
  assert.equal(verifyChain(forged.entries, forged.publicKeyPem, { head: forged.head }).ok, true);
  // ...and fails against the fingerprint the verifier kept from the real ledger.
  assert.deepEqual(verifyChain(forged.entries, forged.publicKeyPem, { head: forged.head, keyId: head.key_id }).broken, { index: 0, reason: "KEY" });
  const { code, out } = verifyFile(forged, "--key-id", head.key_id);
  assert.equal(code, 1, out);
  assert.match(out, /KEY/);
  assert.equal(verifyChain(entries, publicKeyPem, { head, keyId: head.key_id }).ok, true);
  app.close();
});

test("the head's own signature, count and hash are checked; a ledger grown after its head still holds", async () => {
  const app = await sealedApp();
  const { entries, publicKeyPem, head } = app.sealedLedger();
  assert.deepEqual(verifyChain(entries, publicKeyPem, { head: { ...head, count: head.count - 1 } }).broken, { index: 0, reason: "HEAD_SIGNATURE" });
  const older = { ...head };
  await app.runScene(3);
  const grown = app.sealedLedger();
  const r = verifyChain(grown.entries, publicKeyPem, { head: older });
  assert.equal(r.ok, true);
  assert.equal(r.anchor?.count, older.count);
  assert.equal(r.anchor?.beyond, grown.entries.length - older.count);
  assert.equal(grown.head.count, grown.entries.length);
  app.close();
});

test("a ledger without a head still verifies as before, and says a cut at its end would not show", async () => {
  const app = await sealedApp();
  const { entries, publicKeyPem } = app.sealedLedger();
  assert.equal(verifyChain(entries, publicKeyPem).ok, true);
  const { code, out } = verifyFile({ entries, publicKeyPem });
  assert.equal(code, 0, out);
  assert.match(out, /CHAIN_HOLDS/);
  assert.match(out, /no signed head/);
  app.close();
});

test("a persistent ledger reloaded from disk signs a head that verifies against its own entries", async () => {
  const dir = mkdtempSync(join(tmpdir(), "anima-anchor-persist-"));
  const path = join(dir, "receipts.jsonl");
  const first = new Ledger(path);
  first.appendGrant({ merchant: "Studio Lumen", auto_release_cents: 2000, by: "test", at: new Date().toISOString(), basis: "test" } as any);
  const again = new Ledger(path);
  const head = again.head();
  assert.equal(head.count, 1);
  assert.equal(verifyChain(again.sealedEntries(), again.publicKeyPem, { head, keyId: first.head().key_id }).ok, true);
});
