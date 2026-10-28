// In-memory PayPal sandbox simulator, for tests and for the demo when no sandbox credentials are
// configured (the interface then says so). It follows the documented
// Orders v2 states (CREATED -> APPROVED -> authorized -> captured or voided) and replays the
// first answer for a repeated PayPal-Request-Id, like PayPal does.

import type { HttpRequest, HttpResponse, Transport } from "../paypal.ts";

export class SandboxSimulator {
  calls: HttpRequest[] = [];
  private orders = new Map<string, any>();
  private auths = new Map<string, any>();
  private captures = new Map<string, any>();
  /** Invoice numbers PayPal already holds as paid: a second payment is refused with DUPLICATE_INVOICE_ID. */
  private paidInvoices = new Set<string>();
  /** The status the next capture ends with; PENDING models PayPal holding the money before crediting it. */
  captureStatus: "COMPLETED" | "PENDING" = "COMPLETED";
  private replays = new Map<string, HttpResponse>();
  private seq = 0;

  approve(orderId: string): void {
    const o = this.orders.get(orderId);
    if (!o) throw new Error(`unknown order ${orderId}`);
    o.status = "APPROVED";
  }

  get transport(): Transport {
    return async (req) => this.handle(req);
  }

  /** PayPal keeps a PayPal-Request-Id for a limited time; after that, a repeated request is a new one.
   *  Observed 23/10: a card order replayed two hours later met DUPLICATE_INVOICE_ID, not the old answer. */
  forgetRequestIds(): void {
    this.replays.clear();
  }

  /** PayPal credits a pending capture. */
  settle(captureId: string): void {
    const c = this.captures.get(captureId);
    if (!c) throw new Error(`unknown capture ${captureId}`);
    c.status = "COMPLETED";
  }

  captureCount(): number {
    return this.calls.filter((c) => c.url.endsWith("/capture")).length;
  }

  paypalCalls(): number {
    return this.calls.filter((c) => !c.url.endsWith("/v1/oauth2/token")).length;
  }

  private duplicateInvoice(): HttpResponse {
    return { status: 422, json: { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "DUPLICATE_INVOICE_ID" }] } };
  }

  private id(prefix: string): string {
    this.seq += 1;
    return `${prefix}${String(this.seq).padStart(6, "0")}`;
  }

  private handle(req: HttpRequest): HttpResponse {
    this.calls.push(req);
    const path = new URL(req.url).pathname;
    if (path === "/v1/oauth2/token") return { status: 200, json: { access_token: "fake-token", expires_in: 3600 } };
    const rid = req.headers["PayPal-Request-Id"];
    if (rid && this.replays.has(rid)) return this.replays.get(rid)!;
    const res = this.route(req.method, path, req.body ? JSON.parse(req.body) : undefined);
    if (rid && res.status < 300) this.replays.set(rid, res);
    return res;
  }

  private route(method: string, path: string, body: any): HttpResponse {
    let m: RegExpMatchArray | null;
    if (method === "POST" && path === "/v2/checkout/orders") {
      const id = this.id("ORDER");
      // Like PayPal: without a payee the app's own sandbox merchant receives it; with a return URL the
      // order waits for the payer's action.
      const units = body.purchase_units.map((u: any) => ({ payee: { email_address: "merchant@business.example.com" }, ...u }));
      const card = body.payment_source?.card;
      if (card && this.paidInvoices.has(body.purchase_units?.[0]?.invoice_id)) return this.duplicateInvoice();
      if (card) {
        // PayPal authorizes a card at once: the order is COMPLETED with an authorization to capture.
        const authId = this.id("AUTH");
        this.auths.set(authId, { id: authId, status: "CREATED", amount: units[0].amount, invoice_id: units[0].invoice_id });
        const order = { id, status: "COMPLETED", intent: body.intent, payment_source: { card: { brand: "VISA", last_digits: String(card.number).slice(-4) } },
          purchase_units: units.map((u: any) => ({ ...u, payments: { authorizations: [{ id: authId, status: "CREATED" }] } })), links: [] };
        this.orders.set(id, order);
        return { status: 201, json: order };
      }
      const waiting = Boolean(body.payment_source?.paypal?.experience_context?.return_url);
      const order = { id, status: waiting ? "PAYER_ACTION_REQUIRED" : "CREATED", intent: body.intent, purchase_units: units,
        links: [{ rel: waiting ? "payer-action" : "approve", href: `https://www.sandbox.paypal.com/checkoutnow?token=${id}` }] };
      this.orders.set(id, order);
      return { status: 201, json: order };
    }
    if (method === "GET" && (m = path.match(/^\/v2\/checkout\/orders\/([^/]+)$/))) {
      const o = this.orders.get(m[1]);
      return o ? { status: 200, json: o } : { status: 404, json: { name: "RESOURCE_NOT_FOUND" } };
    }
    if (method === "POST" && (m = path.match(/^\/v2\/checkout\/orders\/([^/]+)\/authorize$/))) {
      const o = this.orders.get(m[1]);
      if (!o || o.status !== "APPROVED") return { status: 422, json: { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "ORDER_NOT_APPROVED" }] } };
      if (this.paidInvoices.has(o.purchase_units[0].invoice_id)) return this.duplicateInvoice();
      const authId = this.id("AUTH");
      this.auths.set(authId, { id: authId, status: "CREATED", amount: o.purchase_units[0].amount, invoice_id: o.purchase_units[0].invoice_id });
      o.status = "COMPLETED";
      o.purchase_units[0].payments = { authorizations: [{ id: authId, status: "CREATED" }] };
      return { status: 201, json: o };
    }
    if (method === "POST" && (m = path.match(/^\/v2\/payments\/authorizations\/([^/]+)\/capture$/))) {
      const a = this.auths.get(m[1]);
      if (!a || a.status !== "CREATED") return { status: 422, json: { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "AUTHORIZATION_ALREADY_CAPTURED_OR_VOIDED" }] } };
      a.status = "CAPTURED";
      const capture = { id: this.id("CAPTURE"), status: this.captureStatus, amount: a.amount };
      if (a.invoice_id) this.paidInvoices.add(a.invoice_id);
      this.captures.set(capture.id, capture);
      return { status: 201, json: capture };
    }
    if (method === "POST" && (m = path.match(/^\/v2\/payments\/authorizations\/([^/]+)\/void$/))) {
      const a = this.auths.get(m[1]);
      if (!a || a.status !== "CREATED") return { status: 422, json: { name: "UNPROCESSABLE_ENTITY" } };
      a.status = "VOIDED";
      return { status: 204, json: {} };
    }
    if (method === "GET" && (m = path.match(/^\/v2\/payments\/captures\/([^/]+)$/))) {
      const c = this.captures.get(m[1]);
      return c ? { status: 200, json: c } : { status: 404, json: { name: "RESOURCE_NOT_FOUND" } };
    }
    if (method === "GET" && (m = path.match(/^\/v2\/payments\/authorizations\/([^/]+)$/))) {
      const a = this.auths.get(m[1]);
      return a ? { status: 200, json: a } : { status: 404, json: {} };
    }
    return { status: 404, json: { name: "NOT_FOUND", path } };
  }
}
