// Verify a sealed ANIMA ledger without trusting whoever wrote it.
//   node scripts/verify-ledger.ts ledger.json        (output of GET /api/ledger)
//   node scripts/verify-ledger.ts receipts.jsonl key.pub.pem
// Exit codes: 0 the chain holds, 1 it does not, 2 bad usage.

import { readFileSync } from "node:fs";
import { verifyChain } from "../src/seal.ts";

const [file, keyFile] = process.argv.slice(2);
if (!file) {
  console.log("usage: node scripts/verify-ledger.ts <ledger.json | receipts.jsonl> [public-key.pem]");
  process.exit(2);
}
const text = readFileSync(file, "utf8");
let entries: any[];
let publicKeyPem: string;
if (file.endsWith(".jsonl")) {
  if (!keyFile) { console.log("a .jsonl ledger needs the public key file as second argument"); process.exit(2); }
  entries = text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  publicKeyPem = readFileSync(keyFile, "utf8");
} else {
  ({ entries, publicKeyPem } = JSON.parse(text));
}
const result = verifyChain(entries, publicKeyPem);
console.log(JSON.stringify(result, null, 2));
console.log(result.ok ? `CHAIN_HOLDS: ${result.checked} sealed entries` : `CHAIN_BROKEN at entry ${result.broken!.index} (${result.broken!.reason})`);
process.exit(result.ok ? 0 : 1);
