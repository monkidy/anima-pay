# ANIMA (working title)

**Agents can spend. Make them bring receipts.** Autonomy is earned, never given.

An AI assistant reads your invoices and proposes payments on the PayPal sandbox. It can suggest; it
cannot pay. Money moves only through three locks, in order:

1. **The mandate** you wrote: payees, currency, per-payment and monthly limits, expiry.
2. **Your approval on PayPal itself.** Orders use intent `AUTHORIZE`: funds are held, not taken.
3. **Your release in the app**, required above the amount the agent has earned and whenever the
   assistant or the gate has a doubt (possible duplicate, price change, the model advising to wait).

Every outcome leaves a receipt, including the payments that did **not** happen: what was asked, what
ran, what did not run, and PayPal's own status as evidence. Corrections are appended next to what they
correct, never written over it.

No receipt, no payment.

## What makes it different

- **Sealed receipts.** Each receipt is a link in a hash chain signed with Ed25519. Anyone with the
  public key can verify the ledger; change one cent and the verifier names the entry that broke.
- **Earned trust.** The agent starts with no autonomy at all: even 29 EUR waits for a person. After
  three clean, sealed payments to the same payee it may *propose* paying alone up to a higher amount.
  Nothing changes until a person seals that grant, and the first anomaly takes it back.
- **A council of three voices.** One proposes, one hunts for fraud, one verifies, in separate model
  calls. An unreadable voice counts as an objection. Disagreement is kept in the sealed receipt.
- **The decision theatre.** Each payment is shown as one scene: the invoice on paper, the three voices,
  the three locks, the verdict.
- **PayPal's own agent tools, behind the locks.** PayPal's MCP server gives an agent 46 tools: refunds,
  dispute claims, captures, invoices, subscriptions. ANIMA sits between the agent and those tools: every
  tool is classed by what it can do to money or to people, an unknown tool is refused, reads pass, and a
  refund, a dispute acceptance or a cancellation meets the mandate and waits for a person. The facts come
  from PayPal (a refund's amount from its capture), never from the agent's words, and every outcome is a
  sealed receipt in the same chain as the payments. Any MCP client (Claude Desktop, any agent) can connect to ANIMA's own
  endpoint, `POST /mcp`, instead of to PayPal: it sees the same tools, labelled with what the firewall will
  do, and a held or refused call comes back flagged as not done.

## The advisor

The model reads the invoice and proposes PAY, WAIT or REFUSE with its reasons. It works with any
OpenAI-compatible endpoint (Ollama, llama.cpp, vLLM, OpenAI) or the Anthropic Messages API. The
invoice text is treated as untrusted data; the answer is parsed strictly, and anything malformed,
missing or unreachable becomes WAIT. What the model *read* is compared with the invoice you
recorded: a model fooled by injected text is stopped by the gate before PayPal is ever called.

## The screen and the six scenes

`npm start` opens the desk on http://127.0.0.1:5274 (French or English, switch at the top right): the
mandate, six scenes, what is waiting for you, the trust earned per payee, and every receipt in an AG
Grid ledger. Click a receipt to see what was asked, what ran, the three voices, PayPal's evidence, and
any correction sealed beside the original (the golden seam).

1. **A clean payment.** The model proposes, the mandate allows, the payer approves, a person releases.
2. **The duplicate.** Same payee, same amount, same month: held. A release before the payer's
   approval is blocked by PayPal's own order status; the person declines; PayPal shows no capture.
3. **The poisoned invoice.** A hidden line tells the model to read 999 EUR and pay. A fooled model no
   longer matches the recorded invoice and the gate refuses before PayPal. A model that sees the trap
   refuses, and the payment waits for a person.
4. **The golden seam.** A wrong explanation is corrected beside the original, never over it.
5. **Earned, not given.** Three months of the same seat, each paid through every lock; the agent then
   proposes a step of autonomy, and a person seals it.
6. **Autonomy at work.** The December seat is paid after the payer's approval without asking again.
7. **PayPal's own tools, behind the locks.** An agent with PayPal's agent tools reads the order freely;
   its refund waits for a person, with the amount read from PayPal; a dispute a fake support email pushes
   it to accept, and a cancellation, wait too and are declined. PayPal is never asked.

On the sandbox, a payment can also be paid by PayPal's published test card instead of a person
signing in to PayPal ("test payer"). The mandate and the person's release still apply, and the
receipt says the card stood in for the payer.

On the real sandbox the sealed ledger is kept on disk (git-ignored) with its signing key, because PayPal
remembers every payment and the desk must too: an invoice PayPal already holds as paid is refused by
PayPal (DUPLICATE_INVOICE_ID) and sealed as such, even by a desk that lost its memory.

Without sandbox credentials the desk runs on a local PayPal simulator, and without a model on
scripted answers; both are shown on screen and written into every receipt.

## Status (23 October 2026)

Private build for the PayPal AI Hackathon 2026.

| Part | State |
|---|---|
| Gate, three locks, sealed ledger, earned trust, council, tool firewall, hosted mode | 132 tests pass, including the hostile cases; deliberate sabotages of the protections are caught |
| PayPal | real sandbox: full money path observed on 23/10 (authorize, then capture after a person's release: 29.00 EUR, capture COMPLETED, read back from PayPal), with PayPal's published test card standing in for the payer; declines carry PayPal's status; a release before the payer's approval is blocked. A person approving with a PayPal account: supported, not yet observed |
| PayPal's agent tools | real sandbox MCP server (46 tools, all classed): a refund held, released, and refunded by PayPal (read back: capture REFUNDED); a fake dispute and a cancellation held and declined |
| Model | real: claude-haiku-5-5 over the Anthropic API (`docs/evidence/`) |
| Video | to do |

```bash
npm test          # Node 24+, no dependencies
npm start         # the desk; real sandbox when .env has credentials (ANIMA_SIMULATE=1 forces the simulator)
npm run smoke     # real PayPal sandbox check, needs .env (see below)
npm run mcp-check -- <order-id>  # PayPal's agent tools: all classed, one read through the firewall, needs .env
npm run agent-demo  # a real MCP client on ANIMA's own endpoint (POST /mcp): PayPal's tools behind the locks
```

`.env` (never committed):

```
PAYPAL_CLIENT_ID=...          # sandbox app, developer.paypal.com > Apps & Credentials > Sandbox
PAYPAL_CLIENT_SECRET=...
ADVISOR_KIND=openai-compatible  # or anthropic
ADVISOR_BASE_URL=http://localhost:11434
ADVISOR_MODEL=qwen2.5:7b
ADVISOR_API_KEY=              # optional
```

Sandbox only: the client and the configuration both refuse any non-sandbox PayPal endpoint.

## Local and hosted

Locally (the default) the desk listens on 127.0.0.1 and no other web page may act on it: a request
carrying another site's Origin is refused, so is any Host but the loopback address (a page that rebinds
its own name to 127.0.0.1 can neither write nor read), and writes must be JSON. `ANIMA_HOSTED=1` serves a hosted
demo: every visitor gets a session of their own (HttpOnly, SameSite=Strict cookie) and a desk of their
own; the person who releases or declines is named by the server, never by the request; nobody can see,
release or reset another visitor's payments; runs that may call a model or PayPal (a scene, or one
tool call an agent makes on `/mcp`) are bounded per session
(`ANIMA_SCENE_BUDGET`, default 40) and across all sessions in any 24 hours (`ANIMA_GLOBAL_SCENE_BUDGET`,
default 200, kept in process memory: a restart resets it, so it is not a durable credit cap), so opening
new sessions buys nothing; `ANIMA_MAX_SESSIONS` (default 50) bounds concurrency; a limit that is not a
whole number stops the server instead of switching the limit off;
an agent reaches `/mcp` only with its session's token. Visitors share one PayPal sandbox account, so each
desk sends PayPal request ids and invoice ids of its own (the invoice's number plus a per-desk tag): a
visitor's payment never meets another visitor's, or an earlier run's, at PayPal. Hosted mode answers with scripted advice unless
`ANIMA_HOSTED_MODEL=1`. On anything but loopback the server refuses to start unless `ANIMA_HOSTED` is exactly `1` (the
local mode trusts whoever reaches it), and without an exact https public origin (`ANIMA_PUBLIC_ORIGIN`,
or on Render the service's own address, `RENDER_EXTERNAL_URL`), which is then the only origin allowed
to write and makes the session cookie Secure; HTTPS itself is the host's. Every page
carries a strict Content-Security-Policy: from jsDelivr, only the exact AG Grid build and the three font
packages the page names.
