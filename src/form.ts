// What earned autonomy rests on: the form of the invoice. A person's grant widens what the agent may pay
// alone, and the payments behind that grant were made on documents of one form. So the grant holds for that
// form only: the document the model read must equal, byte for byte, the ones behind the grant, except for the
// values the RECORDED invoice predicts (its number, its date, its amount). Anything else, an added line, an
// invisible character, a look-alike letter, a figure that disagrees with the record, goes back to a person.
//
// This is a comparison, not a classifier: there is no list of suspicious words and nothing here reads what the
// text means. It says "this is not what was paid before"; it does not say who wrote the invoice, and a forgery
// in exactly the same form passes it. The README's "Honest limits" says what stays open.

import { createHash } from "node:crypto";
import { toPayPalValue, type Invoice } from "./model.ts";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** What a number looks like: a short token with a digit. Any other stays literal, and so changes the form. The
 * record is trusted (src/model.ts); this only bounds what a wrong record could slip through this one slot. */
const PLAIN_NUMBER = /^(?=[^\d]*\d)[A-Za-z0-9][A-Za-z0-9._/-]{0,23}$/;

/** Marks a slot. A document containing it has no form at all, so it can never imitate a slot. */
const MARK = "\u0000";

/** The values the record predicts in its own document, longest first. Only these may differ from month to month. */
function predicted(invoice: Invoice): [slot: string, value: string][] {
  const out: [string, string][] = [];
  if (PLAIN_NUMBER.test(invoice.number)) out.push(["number", invoice.number]);
  if (Number.isInteger(invoice.amount_cents) && invoice.amount_cents > 0) out.push(["amount", toPayPalValue(invoice.amount_cents)]);
  const iso = invoice.issued_at.slice(0, 10);
  const issued = new Date(`${iso}T00:00:00Z`);
  if (!Number.isNaN(issued.getTime())) {
    const [day, month, year] = [issued.getUTCDate(), MONTHS[issued.getUTCMonth()], issued.getUTCFullYear()];
    const mon = month.slice(0, 3);
    for (const date of [iso, `${day} ${mon} ${year}`, `${day} ${month} ${year}`, `${month} ${day}, ${year}`, `${mon} ${day}, ${year}`]) out.push(["date", date]);
    out.push(["period", `${month} ${year}`], ["month", month]);
  }
  return out.sort((a, b) => b[1].length - a[1].length);
}

/** Only whole values: 29.00 is not found inside 129.00, nor May inside Mayfair. */
const whole = (value: string) => new RegExp(`(?<![\\p{L}\\p{N}])${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "gu");

/** The form of this document for this recorded invoice, as a hash; null when it cannot have one. No other normalization: not a space. */
export function documentForm(text: string, invoice: Invoice): string | null {
  if (text.includes(MARK)) return null;
  let form = text;
  for (const [slot, value] of predicted(invoice)) form = form.replace(whole(value), `${MARK}${slot}${MARK}`);
  return `sha256:${createHash("sha256").update(form, "utf8").digest("hex")}`;
}
