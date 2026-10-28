// Sealed receipts. Every ledger entry carries the hash of the entry before it and an Ed25519
// signature over its own canonical form, so anyone holding the public key can check, without
// trusting us, that nothing was altered, removed or reordered, and see exactly where if it was.

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const GENESIS = "0".repeat(64);

export interface Seal {
  index: number;
  prev: string;
  hash: string;
  sig: string;
  key_id: string;
}

/** JSON with keys sorted at every depth: the same entry always hashes to the same bytes. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).filter((k) => obj[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(",")}}`;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export class Signer {
  readonly keyId: string;
  readonly publicKeyPem: string;
  private readonly privateKey: KeyObject;

  private constructor(privateKey: KeyObject) {
    this.privateKey = privateKey;
    this.publicKeyPem = createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString();
    this.keyId = sha256(this.publicKeyPem).slice(0, 16);
  }

  /** path = null: a fresh key for this process only (demo, tests). Otherwise created once, then reused. */
  static load(path: string | null): Signer {
    if (path && existsSync(path)) return new Signer(createPrivateKey(readFileSync(path, "utf8")));
    const { privateKey } = generateKeyPairSync("ed25519");
    if (path) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
    }
    return new Signer(privateKey);
  }

  seal(body: unknown, index: number, prev: string): Seal {
    const hash = sha256(`${prev}\n${canonical(body)}`);
    const sig = sign(null, Buffer.from(hash, "hex"), this.privateKey).toString("base64");
    return { index, prev, hash, sig, key_id: this.keyId };
  }
}

export interface VerifyResult {
  ok: boolean;
  checked: number;
  /** First entry that does not hold, and why. */
  broken?: { index: number; reason: "ORDER" | "LINK" | "HASH" | "SIGNATURE" | "MISSING_SEAL" };
}

/** Checks a whole sealed ledger against a public key. Pure: no trust in the writer needed. */
export function verifyChain(entries: readonly { seal?: Seal }[], publicKeyPem: string): VerifyResult {
  const key = createPublicKey(publicKeyPem);
  let prev = GENESIS;
  for (let i = 0; i < entries.length; i++) {
    const { seal, ...body } = entries[i] as { seal?: Seal } & Record<string, unknown>;
    if (!seal) return { ok: false, checked: i, broken: { index: i, reason: "MISSING_SEAL" } };
    if (seal.index !== i) return { ok: false, checked: i, broken: { index: i, reason: "ORDER" } };
    if (seal.prev !== prev) return { ok: false, checked: i, broken: { index: i, reason: "LINK" } };
    if (sha256(`${prev}\n${canonical(body)}`) !== seal.hash) return { ok: false, checked: i, broken: { index: i, reason: "HASH" } };
    if (!verify(null, Buffer.from(seal.hash, "hex"), key, Buffer.from(seal.sig, "base64"))) return { ok: false, checked: i, broken: { index: i, reason: "SIGNATURE" } };
    prev = seal.hash;
  }
  return { ok: true, checked: entries.length };
}
