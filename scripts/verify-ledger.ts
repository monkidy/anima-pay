// Verify a sealed ANIMA ledger without trusting whoever wrote it.
//   node scripts/verify-ledger.ts ledger.json [--key-id <fingerprint>]        (output of GET /api/ledger)
//   node scripts/verify-ledger.ts receipts.jsonl key.pub.pem [head.json] [--key-id <fingerprint>]
// A signed head (in ledger.json, or given as head.json) is checked too: a ledger cut after it fails.
// --key-id pins the key fingerprint you hold from elsewhere: a ledger re-signed whole with another key
// then fails, even though it holds against the key its own file carries.
// Exit codes: 0 the chain holds, 1 it does not, 2 bad usage.

import { readFileSync } from "node:fs";
import { verifyChain, type LedgerHead } from "../src/seal.ts";

const argv = process.argv.slice(2);
const pin = argv.indexOf("--key-id");
const keyId = pin >= 0 ? argv[pin + 1] : undefined;
if (pin >= 0 && !keyId) { console.log("--key-id needs a fingerprint"); process.exit(2); }
const [file, keyFile, headFile] = pin >= 0 ? [...argv.slice(0, pin), ...argv.slice(pin + 2)] : argv;
if (!file) {
  console.log("usage: node scripts/verify-ledger.ts <ledger.json | receipts.jsonl public-key.pem [head.json]> [--key-id <fingerprint>]");
  process.exit(2);
}
const text = readFileSync(file, "utf8");
let entries: any[];
let publicKeyPem: string;
let head: LedgerHead | undefined;
if (file.endsWith(".jsonl")) {
  if (!keyFile) { console.log("a .jsonl ledger needs the public key file as second argument"); process.exit(2); }
  entries = text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  publicKeyPem = readFileSync(keyFile, "utf8");
  if (headFile) head = JSON.parse(readFileSync(headFile, "utf8"));
} else {
  ({ entries, publicKeyPem, head } = JSON.parse(text));
}
if (keyId && !head) { console.log("--key-id needs a signed head to check against"); process.exit(2); }
const result = verifyChain(entries, publicKeyPem, head ? { head, keyId } : undefined);
console.log(JSON.stringify(result, null, 2));
if (!result.ok) console.log(`CHAIN_BROKEN at entry ${result.broken!.index} (${result.broken!.reason})`);
else if (result.anchor) console.log(`CHAIN_HOLDS: ${result.checked} sealed entries; the signed head (${result.anchor.count} entries, key ${result.anchor.key_id}) holds${result.anchor.beyond ? `, ${result.anchor.beyond} written after it` : ""}${keyId ? "" : ". Key not pinned: the head and key come from this file, so this proves only that nobody without that key edited it; pass --key-id <fingerprint> you hold from elsewhere"}`);
else console.log(`CHAIN_HOLDS: ${result.checked} sealed entries (no signed head: a cut at the end would not show)`);
process.exit(result.ok ? 0 : 1);
