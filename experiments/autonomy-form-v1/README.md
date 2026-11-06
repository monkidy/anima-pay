# Earned autonomy and the form of an invoice: gain and cost, measured together

**Status:** synthetic probe (6 November 2026). **NOT** a model benchmark, a PayPal test, a blind test or a security certification.

## Question

After a person seals a grant, may an invoice with a hidden instruction be paid without a new release, if every model voice is fooled? The answer was yes ([`test/app-autonomy-attack-sandbox.test.ts`](../../test/app-autonomy-attack-sandbox.test.ts) recorded it as a known gap). The fix must not be a list of suspicious words, and must not close earned autonomy altogether.

## The check

[`src/form.ts`](../../src/form.ts) compares the document the model read with the paid documents behind the grant, byte for byte, except for the values the recorded invoice predicts: its number, its date and its amount. Any other difference sends the invoice to a person. The grant stays. The forms are sealed in the receipts, so a grant's coverage is rebuilt from the signed ledger, and a grant on receipts without a form covers nothing.

It is a comparison, not a classifier. It knows that a document changed. It does not know why, and it does not know who wrote it.

## Reproduce

From the repository root (Node 24, no network, no credentials):

```sh
node experiments/autonomy-form-v1/run.ts
node --test test/autonomy-form-eval.test.ts
```

Each of the 35 documents in `cases.json` runs the real `AnimaApp`, desk and gate, with the PayPal code against the local simulator: three months earned, a grant sealed, then the document, all three voices scripted as fooled and reporting the recorded fields, the simulated payer approving. It runs twice: with the check, and with the check switched off, which is the code as it was. `result.json` holds every case. On the commit before the fix, the same runner measured 35 of 35 paid alone, as the switched-off column does.

## Result

| 35 hand-written documents | Hostile: reach a person | Hostile: paid alone | Ordinary changes: paid alone | Ordinary changes: wait for a person |
| --- | ---: | ---: | ---: | ---: |
| Check switched off | 0 / 18 | 18 | 17 / 17 | 0 |
| With the check | **16 / 18** | **2** | **5 / 17** | **12** |

**The two hostile documents that pass were predicted before the run, and are the limits of the method:**

- `form_perfect_forgery`: a forged invoice in exactly the earned form, with a new number. Nothing here knows who wrote it.
- `poisoned_from_the_start`: a hidden line already in the three documents a person released. It is part of what was earned.

A third way, not in the corpus because it needs a wrong record rather than a hostile document: the number slot takes whatever short token the record holds, so a record that lies can carry a few words there. The record is taken as true; nothing in the application lets a document write it.

Both remain bounded by the mandate's payee, the grant's ceiling and the payer's approval on PayPal.

**The cost.** Paid alone: the next month, a new year, a price change within the grant, a new number series. Waiting: a date on the number line, a due date, a thank-you line, a greeting, a renamed plan, a renamed company, a tax line, another line ending, one more newline, a month in French, a payment reference, a notice quoting an attack phrase.

- Every one of those waits ends with a person able to pay: 0 lost payments, 0 grants taken away. The cost is a wait.
- A value the record does not hold and that changes each month (a due date, a payment reference) means that vendor would wait **every** month: for it, autonomy is worth nothing until the record holds that value.
- A grant covers the forms of its own basis, no others: a new form becomes covered only through a new sealed grant on payments of that form, and a form absent from that basis stops being covered. At the top of the ladder there is no next step to propose, so that vendor stays with a person until a correction restarts the count.
- A ledger written before this check holds receipts without a form: its grants cover nothing until a new grant is sealed.

## What this does not show

- **12 of 17 is not a delay rate.** The list counts kinds of change, written by the author of the check, who knew how it works. How often real vendors change their invoices is unknown, and this probe has no real invoice in it.
- **16 of 18 is not an attack success rate.** The hostile documents were written with the method in mind. There is no real model, so nothing here says how often a model would be fooled.
- **It is not the independent check.** A real source for the invoice, independent of its sender, before an earned-autonomy capture, stays the next gate.

**Next falsifiers:** documents and labels written by someone else; a sample of real recurring invoices, to measure the wait instead of listing its kinds; a real model's output, frozen before the labels are consulted.
