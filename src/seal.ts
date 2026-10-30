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

/** The short key id every seal carries: the first 16 hex characters of the SHA-256 of the PEM text. */
export const keyIdOf = (publicKeyPem: string) => sha256(publicKeyPem).slice(0, 16);

/**
 * The key's fingerprint, for a verifier to pin: the full SHA-256 of the key itself (its SPKI bytes), so the
 * same key always has the same fingerprint however its PEM was saved, and no PEM text can be ground to match.
 */
export const fingerprintOf = (publicKeyPem: string) => createHash("sha256").update(createPublicKey(publicKeyPem).export({ type: "spki", format: "der" })).digest("hex");

/** A signature as written by Buffer#toString("base64"), or null: anything else (lenient base64, not a string) is not one. */
function base64(sig: unknown): Buffer | null {
  if (typeof sig !== "string") return null;
  const bytes = Buffer.from(sig, "base64");
  return bytes.toString("base64") === sig ? bytes : null;
}

export const HEAD_SCHEMA = "anima.ledger_head.v0";

/**
 * The signed head: how many entries the ledger held and the hash of the last one, signed with the
 * ledger's key. Kept by a verifier, it turns "every entry left holds" into "nothing was cut after this
 * point either": a ledger shorter than its head, or that forks before it, no longer verifies.
 */
export interface LedgerHead {
  schema: typeof HEAD_SCHEMA;
  /** The key's full fingerprint (fingerprintOf), not the short id seals carry. */
  key_id: string;
  count: number;
  head: string;
  at: string;
  sig: string;
}

/** What a head's signature covers. The schema line keeps it apart from an entry's seal, whose input starts with a hash. */
const headDigest = ({ sig: _sig, ...body }: LedgerHead | Omit<LedgerHead, "sig">) => Buffer.from(sha256(`${HEAD_SCHEMA}\n${canonical(body)}`), "hex");

export class Signer {
  readonly keyId: string;
  readonly fingerprint: string;
  readonly publicKeyPem: string;
  private readonly privateKey: KeyObject;

  private constructor(privateKey: KeyObject) {
    this.privateKey = privateKey;
    this.publicKeyPem = createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString();
    this.keyId = keyIdOf(this.publicKeyPem);
    this.fingerprint = fingerprintOf(this.publicKeyPem);
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

  /** Signs the ledger's head as it stands: its entry count and the hash of its last entry. */
  head(count: number, head: string, at = new Date().toISOString()): LedgerHead {
    const body = { schema: HEAD_SCHEMA, key_id: this.fingerprint, count, head, at } as const;
    return { ...body, sig: sign(null, headDigest(body), this.privateKey).toString("base64") };
  }
}

export interface VerifyResult {
  ok: boolean;
  checked: number;
  /**
   * First entry that does not hold, and why. KEY and HEAD_SIGNATURE are found before any entry is read
   * (index 0: nothing can be trusted); TRUNCATED points at the first entry the head says is missing;
   * HEAD_MISMATCH at the entry the head names, which is no longer the one it signed.
   */
  broken?: { index: number; reason: "ORDER" | "LINK" | "HASH" | "SIGNATURE" | "MISSING_SEAL" | "KEY" | "HEAD_SIGNATURE" | "TRUNCATED" | "HEAD_MISMATCH" };
  /** When a signed head was checked and held: what it covers, and how many entries came after it. */
  anchor?: { count: number; head: string; key_id: string; beyond: number };
}

/**
 * The anchor a verifier holds from outside the ledger: a signed head, and the key fingerprint it trusts
 * (from somewhere other than the ledger's own file; without it, the head's own key_id is taken).
 */
export interface Anchor {
  head: LedgerHead;
  keyId?: string;
}

/**
 * Checks a whole sealed ledger against a public key. Pure: no trust in the writer needed. Without an
 * anchor it proves every entry present is intact and in place, not that none was cut from the end; with
 * one, also that the ledger still holds everything the head signed, under the key the verifier expects.
 */
export function verifyChain(entries: readonly { seal?: Seal }[], publicKeyPem: string, anchor?: Anchor): VerifyResult {
  const key = createPublicKey(publicKeyPem);
  if (anchor) {
    const head = anchor.head as LedgerHead | null;
    if (!head || typeof head !== "object") return { ok: false, checked: 0, broken: { index: 0, reason: "HEAD_SIGNATURE" } };
    const fingerprint = fingerprintOf(publicKeyPem);
    if (head.key_id !== fingerprint || (anchor.keyId !== undefined && anchor.keyId !== fingerprint)) return { ok: false, checked: 0, broken: { index: 0, reason: "KEY" } };
    const sig = base64(head.sig);
    let signed = false;
    try { signed = head.schema === HEAD_SCHEMA && sig !== null && verify(null, headDigest(head), key, sig); } catch { signed = false; }
    if (!signed) return { ok: false, checked: 0, broken: { index: 0, reason: "HEAD_SIGNATURE" } };
  }
  let prev = GENESIS;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] as ({ seal?: Seal } & Record<string, unknown>) | null;
    if (!entry || typeof entry !== "object" || !entry.seal || typeof entry.seal !== "object") return { ok: false, checked: i, broken: { index: i, reason: "MISSING_SEAL" } };
    const { seal, ...body } = entry as { seal: Seal } & Record<string, unknown>;
    if (seal.index !== i) return { ok: false, checked: i, broken: { index: i, reason: "ORDER" } };
    if (seal.prev !== prev) return { ok: false, checked: i, broken: { index: i, reason: "LINK" } };
    if (sha256(`${prev}\n${canonical(body)}`) !== seal.hash) return { ok: false, checked: i, broken: { index: i, reason: "HASH" } };
    const sig = base64(seal.sig);
    let signed = false;
    try { signed = sig !== null && verify(null, Buffer.from(seal.hash, "hex"), key, sig); } catch { signed = false; }
    if (!signed) return { ok: false, checked: i, broken: { index: i, reason: "SIGNATURE" } };
    prev = seal.hash;
  }
  if (!anchor) return { ok: true, checked: entries.length };
  const { count, head, key_id } = anchor.head;
  if (entries.length < count) return { ok: false, checked: entries.length, broken: { index: entries.length, reason: "TRUNCATED" } };
  if ((count ? entries[count - 1].seal!.hash : GENESIS) !== head) return { ok: false, checked: entries.length, broken: { index: Math.max(count - 1, 0), reason: "HEAD_MISMATCH" } };
  return { ok: true, checked: entries.length, anchor: { count, head, key_id, beyond: entries.length - count } };
}
