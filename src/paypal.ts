// PayPal Orders v2 over REST, sandbox only. Intent AUTHORIZE: the payer approves on PayPal itself,
// the funds are held, and nothing is taken until a capture that the gate and a person allow.
// https://developer.paypal.com/docs/api/orders/v2/  https://developer.paypal.com/docs/api/payments/v2/

import { createHash } from "node:crypto";
import { toPayPalValue } from "./model.ts";

export const SANDBOX_BASE = "https://api-m.sandbox.paypal.com";

export interface HttpRequest {
  method: "GET" | "POST";
  url: string;
  headers: Record<string, string>;
  body?: string;
}
export interface HttpResponse {
  status: number;
  json: any;
}
export type Transport = (req: HttpRequest) => Promise<HttpResponse>;

export const fetchTransport: Transport = async (req) => {
  const res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : {} };
};

/** RFC 2606 reserves the .example domain: an address there can never hold a PayPal account. */
export function isReservedExample(address: string): boolean {
  return /\.example$/i.test(address.slice(address.lastIndexOf("@") + 1));
}

/** PayPal's published sandbox test Visa (developer.paypal.com/tools/sandbox/card-testing): a fictitious
 * card with no money behind it, valid only on the sandbox, the only place this client talks to. */
export const SANDBOX_TEST_CARD = { number: "4012888888881881", expiry: "2030-12", security_code: "123", name: "ANIMA sandbox test payer" } as const;

/** Who paid, as PayPal reports it: a card (brand and last digits) or a PayPal account. */
export function payerOf(order: any): string | undefined {
  const card = order?.payment_source?.card;
  if (card) return ["card", card.brand, card.last_digits].filter(Boolean).join(" ");
  return order?.payment_source?.paypal?.email_address ?? order?.payer?.email_address;
}

/** Who PayPal names as the payee of an order: an email address or a merchant id. */
export function payeeOf(order: any): string | undefined {
  const payee = order?.purchase_units?.[0]?.payee;
  return payee?.email_address ?? payee?.merchant_id;
}

export class PayPalError extends Error {
  status: number;
  details: unknown;
  /** PayPal's first issue code, when it gave one (for example DUPLICATE_INVOICE_ID). */
  get issue(): string | null {
    const d = this.details as any;
    return d?.details?.[0]?.issue ?? d?.name ?? null;
  }
  constructor(message: string, status: number, details: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export interface PayPalConfig {
  clientId: string;
  clientSecret: string;
  baseUrl?: string;
  transport?: Transport;
  /** True when the transport is the local simulator: receipts must say so. */
  simulated?: boolean;
}

export class PayPalSandbox {
  readonly baseUrl: string;
  readonly provider: "paypal-sandbox" | "paypal-sandbox-simulator";
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly transport: Transport;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(config: PayPalConfig) {
    const baseUrl = config.baseUrl ?? SANDBOX_BASE;
    // Fail closed: this project never talks to live PayPal, whatever the configuration says, and never
    // over plain http: the whole origin (scheme, host, port) must be the sandbox's.
    if (new URL(baseUrl).origin !== new URL(SANDBOX_BASE).origin) {
      throw new Error(`refusing non-sandbox PayPal endpoint: ${baseUrl}`);
    }
    this.baseUrl = baseUrl;
    this.provider = config.simulated ? "paypal-sandbox-simulator" : "paypal-sandbox";
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.transport = config.transport ?? fetchTransport;
  }

  /** The same bearer token opens PayPal's own MCP server (its agent tools). Never logged. */
  bearerToken(): Promise<string> {
    return this.accessToken();
  }

  getCapture(captureId: string) {
    return this.call("GET", `/v2/payments/captures/${encodeURIComponent(captureId)}`);
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");
    const res = await this.transport({
      method: "POST",
      url: `${this.baseUrl}/v1/oauth2/token`,
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    });
    if (res.status !== 200) throw new PayPalError("PayPal token request failed", res.status, res.json);
    this.token = { value: res.json.access_token, expiresAt: Date.now() + Number(res.json.expires_in ?? 0) * 1000 };
    return this.token.value;
  }

  private async call(method: "GET" | "POST", path: string, body?: unknown, requestId?: string): Promise<any> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${await this.accessToken()}`,
      "Content-Type": "application/json",
    };
    // PayPal replays the first answer for a repeated PayPal-Request-Id instead of acting twice.
    if (requestId) headers["PayPal-Request-Id"] = requestId;
    const res = await this.transport({ method, url: `${this.baseUrl}${path}`, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (res.status < 200 || res.status >= 300) {
      // PayPal's own error name and first issue say why (DUPLICATE_INVOICE_ID, ORDER_NOT_APPROVED...); they hold no secret.
      const issue = [res.json?.name, res.json?.details?.[0]?.issue].filter(Boolean).join(": ");
      throw new PayPalError(`PayPal ${method} ${path} failed (HTTP ${res.status}${issue ? `, ${issue}` : ""})`, res.status, res.json);
    }
    return res.json;
  }

  /** Without a payee, the sandbox app's own merchant account receives the order. A reserved example
   * address (the demo's fictitious suppliers) can never hold an account, so that merchant stands in for
   * it; receipts then show who PayPal actually named as payee. returnUrl brings the payer back to the
   * desk after approving on PayPal; PayPal appends the order id (token) to it. With testCard, PayPal's
   * sandbox test card pays instead of a person, and PayPal authorizes at once. */
  createOrder(args: { requestId: string; invoiceNumber: string; payee?: string; currency: string; amountCents: number; description: string; returnUrl?: string; cancelUrl?: string; testCard?: boolean }) {
    const unit: Record<string, unknown> = {
      invoice_id: args.invoiceNumber,
      description: args.description.slice(0, 127),
      amount: { currency_code: args.currency, value: toPayPalValue(args.amountCents) },
    };
    if (args.payee && !isReservedExample(args.payee)) unit.payee = args.payee.includes("@") ? { email_address: args.payee } : { merchant_id: args.payee };
    const body: Record<string, unknown> = { intent: "AUTHORIZE", purchase_units: [unit] };
    if (args.testCard) {
      body.payment_source = { card: { ...SANDBOX_TEST_CARD } };
    } else if (args.returnUrl) {
      body.payment_source = { paypal: { experience_context: {
        return_url: args.returnUrl, cancel_url: args.cancelUrl ?? args.returnUrl, user_action: "CONTINUE", shipping_preference: "NO_SHIPPING",
      } } };
    }
    // A repeated request replays the same order; a request whose content changed is a new request.
    const fingerprint = createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 8);
    return this.call("POST", "/v2/checkout/orders", body, `${args.requestId}-${fingerprint}`);
  }

  getOrder(orderId: string) {
    return this.call("GET", `/v2/checkout/orders/${encodeURIComponent(orderId)}`);
  }

  authorizeOrder(orderId: string, requestId: string) {
    return this.call("POST", `/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`, {}, requestId);
  }

  captureAuthorization(authorizationId: string, requestId: string) {
    return this.call("POST", `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/capture`, { final_capture: true }, requestId);
  }

  voidAuthorization(authorizationId: string, requestId: string) {
    return this.call("POST", `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/void`, undefined, requestId);
  }

  getAuthorization(authorizationId: string) {
    return this.call("GET", `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}`);
  }
}
