// Append-only, sealed ledger. Every receipt and every correction is a new line, hash-chained to the
// line before it and signed; nothing is rewritten, and anyone with the public key can verify it.
// It also carries the idempotency memory, so a restart cannot create a second order or capture.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import type { PastPayment } from "./model.ts";
import type { Correction, PaymentReceipt, ToolReceipt } from "./receipt.ts";
import { TOOL_CLASSES, type PastToolCall } from "./guard.ts";
import { GENESIS, Signer, verifyChain, type LedgerHead, type Seal, type VerifyResult } from "./seal.ts";
import type { TrustGrant } from "./trust.ts";

/** The PayPal object a tool call acts on (a capture, a dispute, an order, an invoice, a subscription). */
export function targetOf(args: Record<string, unknown>): string | undefined {
  for (const k of ["capture_id", "dispute_id", "invoice_id", "subscription_id", "recurring_series_id", "id"]) {
    if (typeof args[k] === "string" && args[k]) return `${k}:${args[k]}`;
  }
  return undefined;
}

export function idempotencyKey(parts: readonly (string | number)[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
}

interface CorrectionEntry extends Correction {
  schema: "anima.correction.v0";
  receipt_id: string;
}

interface GrantEntry extends TrustGrant {
  schema: "anima.trust_grant.v0";
}

type Entry = PaymentReceipt | CorrectionEntry | GrantEntry | ToolReceipt;
type Sealed = Entry & { seal: Seal };

export class Ledger {
  private readonly path: string | null;
  private readonly receipts: PaymentReceipt[] = [];
  private readonly corrections: CorrectionEntry[] = [];
  private readonly grantList: GrantEntry[] = [];
  private readonly toolList: ToolReceipt[] = [];
  /** Every entry in write order, each sealed to the one before it. */
  private readonly chain: Sealed[] = [];
  private readonly signer: Signer;

  /**
   * path = null keeps the ledger in memory (tests, demo); otherwise one sealed JSON entry per line.
   * The signing key lives next to a persistent ledger and is created on first use.
   */
  constructor(path: string | null, signer?: Signer) {
    this.path = path;
    if (path) mkdirSync(dirname(path), { recursive: true });
    this.signer = signer ?? Signer.load(path ? `${path}.ed25519.pem` : null);
    if (path && existsSync(path)) {
      for (const line of readFileSync(path, "utf8").split("\n")) {
        if (line.trim()) this.load(JSON.parse(line) as Sealed);
      }
      // Fail closed: a ledger that does not verify is never used, so no altered grant or capture can count.
      const check = verifyChain(this.chain, this.signer.publicKeyPem);
      if (!check.ok) {
        throw new Error(`ledger ${path} fails verification at entry ${check.broken?.index} (${check.broken?.reason}); refusing to use it. Restore the original file, or move it aside to start a new ledger.`);
      }
    }
  }

  private load(sealed: Sealed): void {
    this.chain.push(sealed);
    const { seal: _seal, ...e } = sealed;
    if (e.schema === "anima.correction.v0") this.corrections.push(e as CorrectionEntry);
    else if (e.schema === "anima.trust_grant.v0") this.grantList.push(e as GrantEntry);
    else if (e.schema === "anima.tool_receipt.v0") this.toolList.push(e as ToolReceipt);
    else this.receipts.push(e as PaymentReceipt);
  }

  private write(e: Entry): void {
    const prev = this.chain.length ? this.chain[this.chain.length - 1].seal.hash : GENESIS;
    const sealed = { ...e, seal: this.signer.seal(e, this.chain.length, prev) } as Sealed;
    this.load(sealed);
    if (this.path) appendFileSync(this.path, JSON.stringify(sealed) + "\n");
  }

  append(receipt: PaymentReceipt): void {
    this.write(receipt);
  }

  /** The golden seam: the correction is stored beside the receipt, which stays as it was. */
  appendCorrection(receiptId: string, c: Correction): void {
    const receipt = this.receipts.find((r) => r.receipt_id === receiptId);
    if (!receipt) throw new Error(`unknown receipt ${receiptId}`);
    if (!(c.field in receipt)) throw new Error(`unknown receipt field: ${c.field}`);
    this.write({ schema: "anima.correction.v0", receipt_id: receiptId, ...c });
  }

  /** A person's sealed grant of autonomy to the agent for one merchant. */
  appendGrant(g: TrustGrant): void {
    this.write({ schema: "anima.trust_grant.v0", ...g });
  }

  /** A call to PayPal's own tools, sealed in the same chain as payments. */
  appendTool(receipt: ToolReceipt): void {
    this.write(receipt);
  }

  toolReceipts(): ToolReceipt[] {
    return [...this.toolList];
  }

  /** True when PayPal already ran this call: a second run would be a second refund. */
  toolExecuted(callId: string): ToolReceipt | undefined {
    return this.toolList.find((r) => r.call.id === callId && r.executed);
  }

  /** Calls PayPal ran, for budgets and repeated-call checks. */
  pastToolCalls(): PastToolCall[] {
    return this.toolList.filter((r) => r.executed && !r.result?.is_error && TOOL_CLASSES[r.call.tool]).map((r) => ({
      tool: r.call.tool, amount_cents: r.resolved.amount_cents ?? 0, currency: r.resolved.currency ?? "", at: r.created_at, target: targetOf(r.call.args),
    }));
  }

  grants(): TrustGrant[] {
    return this.grantList.map(({ schema: _s, ...g }) => g);
  }

  /** The public half of the signing key: enough for anyone to verify, useless to forge. */
  get publicKeyPem(): string {
    return this.signer.publicKeyPem;
  }

  sealedEntries(): readonly Sealed[] {
    return this.chain;
  }

  /** The signed head as the ledger stands now: a verifier who keeps it will see any later cut. */
  head(): LedgerHead {
    return this.signer.head(this.chain.length, this.chain.length ? this.chain[this.chain.length - 1].seal.hash : GENESIS);
  }

  verify(): VerifyResult {
    return verifyChain(this.chain, this.signer.publicKeyPem);
  }

  /** Receipts as they were written, each with the corrections appended to it since. */
  all(): PaymentReceipt[] {
    return this.receipts.map((r) => ({
      ...r,
      corrections: [...r.corrections, ...this.corrections.filter((c) => c.receipt_id === r.receipt_id)
        .map(({ schema: _s, receipt_id: _id, ...c }) => c)],
    }));
  }

  capturedFor(key: string): PaymentReceipt | undefined {
    return this.receipts.find((r) => r.boundary.idempotency_key === key && r.money_moved);
  }

  pastPayments(invoices: ReadonlyMap<string, { number: string; merchant: string; currency: string; amount_cents: number; issued_at?: string }>): PastPayment[] {
    const out: PastPayment[] = [];
    for (const r of this.receipts) {
      if (!r.money_moved) continue;
      const inv = invoices.get(r.boundary.invoice_id);
      if (inv) out.push({ invoice_number: inv.number, merchant: inv.merchant, currency: inv.currency, amount_cents: inv.amount_cents, captured_at: r.created_at, issued_at: inv.issued_at });
    }
    return out;
  }
}
