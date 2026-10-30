// The application behind the screen: one desk, one ledger, the six scenes, and the actions a
// person can take. It runs on the real PayPal sandbox and a real model when they are configured,
// and on the sandbox simulator and scripted answers otherwise; mode() says which, always.

import { AnthropicAdvisor, OpenAICompatibleAdvisor, toProposal, type Advice, type Advisor, type Fetcher } from "./advisor.ts";
import { deliberate, seat, type Completer, type Deliberation, type Opinion } from "./council.ts";
import type { AnimaConfig } from "./config.ts";
import { PaymentDesk, type PendingPayment } from "./desk.ts";
import { Ledger } from "./ledger.ts";
import type { Invoice, PastPayment } from "./model.ts";
import { PayPalSandbox, type Transport } from "./paypal.ts";
import type { PaymentReceipt, ToolReceipt } from "./receipt.ts";
import { FR, GOLDEN_SEAM_CORRECTION, MANDATE, NO_OBJECTION_ADVERSARY, NO_OBJECTION_VERIFIER, SCENES, TOOL_MANDATE, TOOL_SCENE, TRUST_STORY, type Scene } from "./scenes.ts";
import { randomBytes, randomUUID } from "node:crypto";
import { McpSseClient, type ToolBackend, type ToolInfo, type ToolResult } from "./mcp.ts";
import { McpSimulator } from "./sim/mcp-sim.ts";
import { ToolDesk, jsonOf, paypalError, paypalFacts, paypalFailed, paypalFailure, type ToolOutcome } from "./tooldesk.ts";
import { TOOL_CLASSES, type ToolCall } from "./guard.ts";
import { SandboxSimulator } from "./sim/sandbox-sim.ts";
import { CATCHPHRASE, GATE_WIZARD, PHRASES, SLOGAN } from "./verdict.ts";
import { merchantTrust } from "./trust.ts";

/** Stand-in for a model when none is configured. Its answers come from the scene script. */
export class ScriptedAdvisor implements Advisor {
  readonly model = "scripted answers (no model configured)";
  private readonly script = new Map<string, Advice>();
  private readonly voices = new Map<string, { adversary: Opinion; verifier: Opinion }>();
  set(invoiceNumber: string, advice: Advice, council?: { adversary?: Opinion; verifier?: Opinion }): void {
    this.script.set(invoiceNumber, advice);
    this.voices.set(invoiceNumber, { adversary: council?.adversary ?? NO_OBJECTION_ADVERSARY, verifier: council?.verifier ?? NO_OBJECTION_VERIFIER });
  }
  council(invoiceNumber: string): { adversary: Opinion; verifier: Opinion } {
    return this.voices.get(invoiceNumber) ?? { adversary: NO_OBJECTION_ADVERSARY, verifier: NO_OBJECTION_VERIFIER };
  }
  async advise(invoiceText: string): Promise<Advice> {
    for (const [number, advice] of this.script) if (invoiceText.includes(number)) return advice;
    return { read: { invoice_number: "", merchant: "", currency: "", amount_cents: 0 }, recommendation: "WAIT", reasons: ["No scripted answer for this invoice."] };
  }
}

/** The scene script: every scene's scripted answer and council voices. */
function sceneScript(): ScriptedAdvisor {
  const script = new ScriptedAdvisor();
  for (const s of [...SCENES, ...TRUST_STORY]) for (const si of [...s.seed, s.invoice]) script.set(si.invoice.number, si.scripted, si.council);
  return script;
}

/** How many runs a hosted demo's live model may answer, shared by every visitor. */
export interface LiveBudget {
  /** One run for the live model, or false when the budget is spent. */
  take(): boolean;
}

/** Runs over the last 24 hours. In process memory: a restart resets it, so the provider-side cap stays the real one. */
export function rollingBudget(limit: number, now: () => number = Date.now): LiveBudget {
  const runs: number[] = [];
  return {
    take() {
      const t = now();
      while (runs.length && t - runs[0] > 86_400_000) runs.shift();
      if (runs.length >= limit) return false;
      runs.push(t);
      return true;
    },
  };
}

export interface SceneRun {
  scene: number;
  title: string;
  advice: Advice;
  council: Deliberation;
  model: string;
  outcome: "refused" | "awaiting_payer";
  receipt?: PaymentReceipt;
  pending_key?: string;
}

/** One call of scene 7 and what became of it. */
export interface ToolStep {
  call: ToolCall;
  /** Whose tools the call went to: PayPal's, or the simulated ones. */
  provider: ToolReceipt["provider"];
  kind: ToolOutcome["kind"] | "error";
  receipt_id?: string;
  /** For a read: whether PayPal answered, and the top-level fields of its answer, or its error. */
  read?: { ok: boolean; fields: string[]; error?: string };
  /** When the desk itself failed. */
  error?: string;
}

export interface ToolSceneRun {
  scene: 7;
  title: string;
  steps: ToolStep[];
  /** Why a step was left out, when it was. */
  skipped: string[];
  /** Set when the steps ran on the simulated tools because PayPal's tool server failed (toolsFallback). */
  tools_fallback: ToolsFallback | null;
}

/** Why a hosted demo's scene 7 left PayPal's tools: the read their server failed before sending to PayPal. */
export interface ToolsFallback {
  tool: string;
  code: string;
  message: string;
  at: string;
}

type ToolProvider = ToolReceipt["provider"];

/** PayPal's tools as their in-memory stand-in answers them. */
function simulatedTools(): ToolBackend {
  return new McpSseClient({ token: async () => "simulated", fetcher: new McpSimulator().fetcher });
}

export class AnimaApp {
  private readonly simulator: SandboxSimulator | null;
  private readonly advisor: Advisor;
  private readonly scripted: ScriptedAdvisor | null;
  /** A hosted demo's safety net: the scene script answers when the live model cannot, and says so. */
  private readonly fallback: { script: ScriptedAdvisor; budget: LiveBudget } | null;
  /** Scene 5's past months, replayed: always the scene script's written answers, labelled as such. */
  private readonly pastMonths: ScriptedAdvisor;
  private readonly paypalMode: "paypal-sandbox" | "simulated-sandbox";
  private ledger: Ledger;
  private desk: PaymentDesk;
  private readonly paypal: PayPalSandbox;
  private imported: PastPayment[] = [];
  private readonly invoices = new Map<string, Invoice>();
  /** Orders the simulated payer approved. On the real sandbox, PayPal itself holds this state. */
  private readonly payerApproved = new Set<string>();
  private readonly ledgerPath: string | null;
  private readonly tools: ToolBackend;
  /** The tool desks, never closed before a reset: first the one on PayPal's tools (an outside agent's calls
   * always go there), then, once the safety net left PayPal's tools, the one scene 7 goes on with. Each holds
   * its own calls, and decides them. */
  private toolDesks: { desk: ToolDesk; provider: ToolProvider }[] = [];
  private readonly toolsFallback: boolean;
  /** Set once PayPal's tool server failed before sending a read: new calls then go to the simulated tools. */
  private toolsFellBack: ToolsFallback | null = null;
  private simulated: ToolBackend | null = null;
  private toolCatalog: ToolInfo[] | null = null;

  private readonly returnUrl: string | undefined;
  private readonly sharedPayPal: boolean;

  /** transport: only for tests, to drive the real-sandbox code path against a stand-in. */
  /** returnUrl: this desk's own address, where PayPal sends the payer back. */
  /** sharedPayPal: this app is one of many on the same PayPal account (a hosted demo): every desk it opens
   * gets PayPal ids of its own, so one visitor's payments never collide with another's or with earlier runs. */
  /** liveFallback: a hosted demo's live-model budget; with it, a run the live model cannot answer (provider
   * unreachable or failing, budget spent) is answered by the scene script, labelled as such. Without it, as
   * on the local desk, such a run stays the advisor's fail-safe WAIT. */
  /** advisorFetcher: only for tests, to stand in for the model provider. */
  /** toolsFallback: a hosted demo's safety net for scene 7; when PayPal's tool server fails before sending a
   * read to PayPal, the scene goes on with the simulated tools, labelled as such. Without it, as on the local
   * desk, every call stays on PayPal's tools and each failure is sealed as it happened. */
  /** toolsFetcher: only for tests, to stand in for PayPal's tool server. */
  constructor(config: AnimaConfig, opts: { persist?: boolean; transport?: Transport; returnUrl?: string; sharedPayPal?: boolean; liveFallback?: LiveBudget; advisorFetcher?: Fetcher; toolsFallback?: boolean; toolsFetcher?: Fetcher } = {}) {
    this.returnUrl = opts.returnUrl;
    this.sharedPayPal = opts.sharedPayPal ?? false;
    this.toolsFallback = Boolean(opts.toolsFallback && config.paypal);
    if (config.paypal) {
      this.simulator = null;
      this.paypal = new PayPalSandbox({ ...config.paypal, transport: opts.transport });
      this.paypalMode = "paypal-sandbox";
    } else {
      this.simulator = new SandboxSimulator();
      this.paypal = new PayPalSandbox({ clientId: "simulated", clientSecret: "simulated", transport: this.simulator.transport, simulated: true });
      this.paypalMode = "simulated-sandbox";
    }
    if (config.advisor) {
      const a = config.advisor;
      const fetcher = opts.advisorFetcher;
      this.advisor = a.kind === "anthropic"
        ? new AnthropicAdvisor({ baseUrl: a.baseUrl, model: a.model, apiKey: a.apiKey ?? "", fetcher })
        : new OpenAICompatibleAdvisor({ baseUrl: a.baseUrl, model: a.model, apiKey: a.apiKey, fetcher });
      this.scripted = null;
      this.fallback = opts.liveFallback ? { script: sceneScript(), budget: opts.liveFallback } : null;
    } else {
      this.scripted = sceneScript();
      this.advisor = this.scripted;
      this.fallback = null;
    }
    this.pastMonths = this.scripted ?? this.fallback?.script ?? sceneScript();
    this.ledgerPath = opts.persist ? config.ledgerPath : null;
    this.ledger = new Ledger(this.ledgerPath);
    this.desk = this.newDesk();
    // PayPal's own agent tools: the real sandbox server when credentials exist, its stand-in otherwise.
    this.tools = config.paypal
      ? new McpSseClient({ token: () => this.paypal.bearerToken(), fetcher: opts.toolsFetcher })
      : simulatedTools();
    this.openToolDesks();
  }

  private openToolDesks(): void {
    this.simulated?.close();
    this.simulated = null;
    this.toolsFellBack = null;
    this.toolDesks = [this.newToolDesk(this.tools, this.simulator ? "paypal-sandbox-mcp-simulator" : "paypal-sandbox-mcp")];
  }

  private newToolDesk(tools: ToolBackend, provider: ToolProvider): { desk: ToolDesk; provider: ToolProvider } {
    return { provider, desk: new ToolDesk({ tools, ledger: this.ledger, mandate: () => TOOL_MANDATE,
      resolver: paypalFacts({ capture: (id) => this.paypal.getCapture(id) }), provider }) };
  }

  /** Where scene 7's new calls go. */
  private get sceneDesk(): { desk: ToolDesk; provider: ToolProvider } {
    return this.toolDesks[this.toolDesks.length - 1];
  }

  /** The desk holding a call, which alone may release or decline it. */
  private deskHolding(callId: string): ToolDesk {
    return this.toolDesks.find((d) => d.desk.pendingList().some((p) => p.call.id === callId))?.desk ?? this.toolDesks[0].desk;
  }

  /** The safety net (toolsFallback): PayPal's tool server answered a read with PAYPAL_API_SETUP_ERROR, its own
   * code for failing before the request was sent to PayPal, so PayPal decided nothing. New calls then go to the
   * simulated tools, whose receipts name them; the desk on PayPal's tools keeps the calls it already holds. A
   * PayPal refusal, or no answer at all, is PayPal's outcome and leaves the scene where it is. Only an answer
   * from this session's desk on PayPal's tools counts: a run that outlived a reset switches nothing. */
  private fellBack(desk: ToolDesk, tool: string, result: ToolResult): boolean {
    if (!this.toolsFallback || this.toolsFellBack || desk !== this.toolDesks[0].desk || paypalFailure(result) !== "not_sent") return false;
    const { code, message } = paypalError(result)!;
    this.toolsFellBack = { tool, code, message: message.slice(0, 120), at: new Date().toISOString() };
    this.simulated = simulatedTools();
    this.toolDesks = [...this.toolDesks, this.newToolDesk(this.simulated, "paypal-sandbox-mcp-simulator")];
    return true;
  }

  /** PayPal's tools as the agent sees them, each with the class the firewall gives it. */
  async toolList(): Promise<(ToolInfo & { anima_class: string | null })[]> {
    this.toolCatalog ??= await this.tools.listTools();
    return this.toolCatalog.map((t) => ({ ...t, anima_class: TOOL_CLASSES[t.name] ?? null }));
  }

  /** An agent asks for one of PayPal's tools; the desk decides. */
  toolRequest(tool: string, args: Record<string, unknown>, reason: string, agent: string): Promise<ToolOutcome> {
    // An outside agent always works PayPal's own tools: the safety net is scene 7's, and the agent is told PayPal's
    // answers, failures included, never the simulator's.
    return this.toolDesks[0].desk.request({ id: `call-${randomUUID()}`, tool, args, reason, agent, requested_at: new Date().toISOString() });
  }

  toolRelease(callId: string, by: string, acknowledged: string[] = []) {
    return this.deskHolding(callId).release(callId, { by, at: new Date().toISOString(), acknowledged });
  }

  toolDecline(callId: string, by: string, reason: string) {
    return this.deskHolding(callId).decline(callId, by, reason);
  }

  /** Scene 7: a scripted agent works PayPal's own tools; every write meets the locks. */
  async runToolScene(): Promise<ToolSceneRun> {
    const agent = "scripted demo agent";
    const paid = this.ledger.all().filter((r) => r.money_moved && r.evidence?.capture_id).pop();
    const skipped: string[] = [];
    // The read is get_order on the paid order: the sandbox app may lack transaction-search permission
    // (list_transactions answered 403 on 23/10), and looking at the order is what the agent needs anyway.
    const plan: { tool: string; args: Record<string, unknown>; reason: string }[] = [];
    if (paid) {
      plan.push({ tool: "get_order", args: { id: paid.evidence!.order_id }, reason: `Look at the order for invoice ${paid.request.invoice_number} before answering the customer.` });
      plan.push({ tool: "create_refund", args: { capture_id: paid.evidence!.capture_id }, reason: `The customer asked for a refund of invoice ${paid.request.invoice_number}.` });
    } else skipped.push("get_order, create_refund: no captured payment yet; pay scene 1 (or the first month of scene 5) to the end first.");
    plan.push(
      { tool: "accept_dispute_claim", args: { dispute_id: "PP-D-ANIMA-DEMO", note: "settle-now" }, reason: "A support email said to accept this dispute at once to avoid fees." },
      { tool: "cancel_subscription", args: { subscription_id: "I-ANIMADEMO0000", payload: { reason: "Tidy up old subscriptions" } }, reason: "Tidy up subscriptions that look unused." },
    );
    const steps: ToolStep[] = [];
    for (const p of plan) {
      const call: ToolCall = { id: `call-${randomUUID()}`, tool: p.tool, args: p.args, reason: p.reason, agent, requested_at: new Date().toISOString() };
      let at = this.sceneDesk;
      try {
        let out = await at.desk.request(call);
        // PayPal never received that read, so asking the simulated tools now is the read's only answer.
        if (out.kind === "read" && this.fellBack(at.desk, call.tool, out.result)) {
          at = this.sceneDesk;
          out = await at.desk.request(call);
        }
        if (out.kind === "read") {
          const json = jsonOf(out.result);
          steps.push({ call, provider: at.provider, kind: "read", read: paypalFailed(out.result)
            ? { ok: false, fields: [], error: (out.result.content?.[0]?.text ?? "").slice(0, 160) }
            : { ok: true, fields: json && typeof json === "object" ? Object.keys(json).slice(0, 4) : [] } });
        } else steps.push({ call, provider: at.provider, kind: out.kind, receipt_id: out.kind === "held" ? undefined : out.receipt.receipt_id });
      } catch (e) {
        steps.push({ call, provider: at.provider, kind: "error", error: (e as Error).message });
      }
    }
    return { scene: 7, title: TOOL_SCENE.title, steps, skipped, tools_fallback: this.toolsFellBack };
  }

  private newDesk(): PaymentDesk {
    return new PaymentDesk({ paypal: this.paypal, ledger: this.ledger, imported: () => this.imported,
      releaseThreshold: (m, merchant) => this.trust(merchant).granted_cents, returnUrl: this.returnUrl,
      paypalScope: this.sharedPayPal ? randomBytes(4).toString("hex") : undefined });
  }

  mode() {
    return {
      paypal: this.paypalMode,
      advisor: this.advisor.model,
      /** Where new calls to PayPal's tools go, and why they left PayPal's tools when they did. */
      tools: this.sceneDesk.provider,
      tools_fallback: this.toolsFellBack,
      simulated: this.paypalMode === "simulated-sandbox" || this.scripted !== null || this.toolsFellBack !== null,
    };
  }

  /** Back to an empty ledger. Only for the in-memory demo ledger. */
  reset(): void {
    if (this.ledgerPath) throw new Error("refusing to reset a persistent ledger");
    this.ledger = new Ledger(null);
    this.imported = [];
    this.invoices.clear();
    this.payerApproved.clear();
    this.desk = this.newDesk();
    this.openToolDesks();
  }

  async runScene(n: number): Promise<SceneRun> {
    const scene = SCENES.find((s) => s.n === n);
    if (!scene) throw new Error(`no scene ${n}`);
    for (const past of scene.seed) {
      if (!this.imported.some((p) => p.invoice_number === past.invoice.number)) {
        this.imported.push({ invoice_number: past.invoice.number, merchant: past.invoice.merchant, currency: past.invoice.currency, amount_cents: past.invoice.amount_cents, captured_at: new Date(Date.now() - 12 * 86_400_000).toISOString(), issued_at: past.invoice.issued_at });
      }
    }
    if (scene.n === 5) {
      const runs = await this.replayTrustStory("Studio Lumen");
      if (runs.length === 0) throw new Error("the trust story is complete: August, September and October are paid");
      return runs[runs.length - 1];
    }
    return this.review(scene);
  }

  private async review(scene: Scene, pastMonth = false): Promise<SceneRun> {
    const { invoice, text } = scene.invoice;
    this.invoices.set(invoice.id, invoice);
    const history = [...this.imported, ...this.ledger.pastPayments(this.invoices)];
    const recent = history.map((p) => `${p.invoice_number} ${p.merchant} ${(p.amount_cents / 100).toFixed(2)} ${p.currency} issued ${(p.issued_at ?? p.captured_at).slice(0, 10)}, paid`);
    const { advice, model, script } = pastMonth ? await this.replayed(text) : await this.answer(text, recent);
    const recorded = { invoice_number: invoice.number, merchant: invoice.merchant, currency: invoice.currency, amount_cents: invoice.amount_cents };
    const voices = script?.council(invoice.number);
    const council = voices
      ? seat(advice, voices.adversary, voices.verifier, model)
      : await deliberate(this.advisor as unknown as Completer, { invoiceText: text, recorded, recentPayments: recent }, advice);
    const proposal = { ...toProposal(invoice, advice, model), council };
    const out = await this.desk.review(MANDATE, invoice, proposal);
    return out.kind === "refused"
      ? { scene: scene.n, title: scene.title, advice, council, model, outcome: "refused", receipt: out.receipt }
      : { scene: scene.n, title: scene.title, advice, council, model, outcome: "awaiting_payer", pending_key: out.pending.key };
  }

  /** Who answers this run: the live model, or the scene script, whose label then says why. */
  private async answer(text: string, recent: string[]): Promise<{ advice: Advice; model: string; script: ScriptedAdvisor | null }> {
    if (this.scripted) return { advice: await this.scripted.advise(text), model: this.scripted.model, script: this.scripted };
    const fb = this.fallback;
    const scripted = async (s: ScriptedAdvisor, why: string) => ({ advice: await s.advise(text), model: `scripted answers (${why})`, script: s });
    if (fb && !fb.budget.take()) return scripted(fb.script, "the live model's daily budget is spent");
    const advice = await this.advisor.advise(text, { recentPayments: recent });
    if (fb && advice.unavailable) return scripted(fb.script, `live model unavailable: ${advice.unavailable}`);
    return { advice, model: this.advisor.model, script: null };
  }

  /** A past month of scene 5 is history being replayed, not a decision a model is asked to make today: the
   * scene script's written answers give it, and the run's label (sealed in its receipt) says so. */
  private async replayed(text: string): Promise<{ advice: Advice; model: string; script: ScriptedAdvisor }> {
    const s = this.pastMonths;
    return { advice: await s.advise(text), model: this.scripted ? s.model : "scripted answers (a past month, replayed)", script: s };
  }

  /** Simulated sandbox only. On the real sandbox the payer approves on PayPal through approve_url. */
  approveAsPayer(key: string): void {
    if (!this.simulator) throw new Error("on the PayPal sandbox the payer approves on PayPal itself (approve_url)");
    const p = this.desk.pendingList().find((x) => x.key === key);
    if (!p) throw new Error(`no pending payment ${key}`);
    this.simulator.approve(p.order_id);
    this.payerApproved.add(p.order_id);
  }

  payerStatus(key: string) {
    return this.desk.payerStatus(key);
  }

  /** Sandbox only: PayPal's test card stands in for the payer (see PaymentDesk.standInTestPayer). */
  standInTestPayer(key: string) {
    return this.desk.standInTestPayer(key);
  }

  release(key: string, by?: string, acknowledged: string[] = []): Promise<PaymentReceipt> {
    return this.desk.release(key, by ? { by, at: new Date().toISOString(), acknowledged } : undefined);
  }

  decline(key: string, by: string, reason: string): Promise<PaymentReceipt> {
    return this.desk.decline(key, by, reason);
  }

  correct(receiptId: string, by: string, field: string, replacement: string, reason: string): PaymentReceipt {
    const r = this.ledger.all().find((x) => x.receipt_id === receiptId);
    if (!r) throw new Error(`unknown receipt ${receiptId}`);
    const previous = String((r as any)[field] ?? "");
    this.ledger.appendCorrection(receiptId, { at: new Date().toISOString(), by, field, previous, replacement, reason });
    return this.ledger.all().find((x) => x.receipt_id === receiptId)!;
  }

  trust(merchant: string) {
    return merchantTrust(merchant, MANDATE.human_release_above_cents, this.ledger.sealedEntries());
  }

  /** A person accepts the agent's proposed step for one merchant. The grant is sealed in the chain. */
  grantTrust(merchant: string, by: string) {
    const t = this.trust(merchant);
    if (!t.proposal) throw new Error(`no step to grant for ${merchant}: ${t.streak} clean payments since the last grant or anomaly`);
    this.ledger.appendGrant({ merchant, auto_release_cents: t.proposal.to_cents, by, at: new Date().toISOString(), basis: t.proposal.basis });
    return this.trust(merchant);
  }

  /** Scene 5: three past months of the same seat, each paid through every lock, so trust has a record.
   * Each month is answered by the scene script, labelled (see replayed): a live model's objection to a past
   * month would otherwise hold it, and nobody here may acknowledge a hold for a person. The replay never
   * does: a month it cannot pay without one stays pending, and the story stops there for the visitor to
   * read, acknowledge and release it. It resumes where it stopped: months already paid are skipped. On the
   * real sandbox the payer approves each month on PayPal itself, so it also stops at the first month
   * waiting for that approval. */
  async replayTrustStory(by: string): Promise<SceneRun[]> {
    const runs: SceneRun[] = [];
    for (const n of TRUST_STORY) {
      if (this.paid(n.invoice.invoice.number)) continue;
      const run = await this.review(n, true);
      runs.push(run);
      if (run.outcome !== "awaiting_payer" || !this.simulator) break;
      this.approveAsPayer(run.pending_key!);
      run.receipt = await this.release(run.pending_key!, by);
      if (!run.receipt.money_moved) break;
    }
    return runs;
  }

  private paid(invoiceNumber: string): boolean {
    return this.ledger.all().some((r) => r.money_moved && r.request.invoice_number === invoiceNumber);
  }

  /** Closes the stream to PayPal's tools; nothing else holds a connection open. */
  close(): void {
    this.tools.close();
    this.simulated?.close();
  }

  verifyLedger() {
    return this.ledger.verify();
  }

  /** Everything an outside verifier needs: the sealed entries, the public key and the signed head, nothing secret. */
  sealedLedger() {
    return { entries: this.ledger.sealedEntries(), publicKeyPem: this.ledger.publicKeyPem, head: this.ledger.head() };
  }

  goldenSeam(receiptId: string, by: string): PaymentReceipt {
    const c = GOLDEN_SEAM_CORRECTION;
    return this.correct(receiptId, by, c.field, c.replacement, c.reason);
  }

  state() {
    return {
      slogan: SLOGAN,
      catchphrase: CATCHPHRASE,
      phrases: PHRASES,
      wizard: GATE_WIZARD,
      mode: this.mode(),
      mandate: MANDATE,
      scenes: [...SCENES.map((s) => ({ n: s.n, title: s.title, teaches: s.teaches, invoice_text: s.invoice.text, amount_cents: s.invoice.invoice.amount_cents, merchant: s.invoice.invoice.merchant })),
        { n: TOOL_SCENE.n, title: TOOL_SCENE.title, teaches: TOOL_SCENE.teaches, invoice_text: null, amount_cents: null, merchant: null }],
      tool_mandate: TOOL_MANDATE,
      tool_classes: TOOL_CLASSES,
      tool_pending: this.toolDesks.flatMap(({ desk, provider }) => desk.pendingList().map((p) => ({ call: p.call, klass: p.gate.klass, resolved: p.resolved, verdict: p.gate.verdict, findings: p.gate.findings,
        holds: p.gate.findings.filter((f) => f.impact === "hold").map((f) => f.id), provider }))),
      tool_receipts: this.ledger.toolReceipts().reverse(),
      imported: this.imported,
      pending: this.desk.pendingList().map((p: PendingPayment) => ({
        key: p.key, invoice: p.invoice, order_id: p.order_id, approve_url: p.approve_url, stand_in: p.stand_in ?? null,
        payer_approved: this.simulator ? this.payerApproved.has(p.order_id) : null,
        verdict: p.gate.verdict, findings: p.gate.findings, human_release_required: p.gate.human_release_required,
        holds: p.gate.findings.filter((f) => f.impact === "hold").map((f) => f.id),
        recommendation: p.proposal.recommendation, reasons: p.proposal.reasons,
      })),
      receipts: this.ledger.all().slice().reverse(),
      seal: { ...this.ledger.verify(), entries: this.ledger.sealedEntries().length },
      trust: MANDATE.merchants.map((m) => this.trust(m)),
      fr: FR,
    };
  }
}
