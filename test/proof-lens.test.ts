// AG Grid proof-lens metadata never guesses payment outcomes or treats advice as provider evidence.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createContext, runInContext } from "node:vm";
import { readFileSync } from "node:fs";
const ctx = createContext({});
runInContext(readFileSync(new URL("../web/proof-lens.js", import.meta.url), "utf8"), ctx);
const p = (ctx as any).animaProofLens;
const e = (x: any) => JSON.parse(JSON.stringify(x));
const data = [
  { id: "paid", moved: true, corrected: false },
  { id: "refused", moved: false, corrected: false },
  { id: "corrected", moved: true, corrected: true },
  { id: "partial", moved: false, corrected: false },
];
test("every receipt counts once, without labelling no-money as fraud or equating provider with completion", () => {
  const rows = p.entries(
    [{ receipt_id: "paid", money_moved: true, corrections: [] },
      { receipt_id: "refused", money_moved: false, corrections: [] },
      { receipt_id: "corrected", money_moved: true, corrections: [{ field: "explanation" }] },
      { receipt_id: "partial", money_moved: false, status: "PARTIAL", corrections: [] }],
    []);
  assert.deepEqual(e(rows), data);
  assert.deepEqual(e(p.counts(rows)), { total: 4, moved: 2, notMoved: 2, corrected: 1 });
});
test("tool receipts and absent fields cannot invent money movement or corrections", () => {
  const all = p.entries([{ receipt_id: "payment", money_moved: false }],
    [{ receipt_id: "tool", status: "COMPLETED", executed: true, money_moved: false },
      { receipt_id: "refund", money_moved: true }]);
  assert.deepEqual(e(p.counts(all)), { total: 3, moved: 1, notMoved: 2, corrected: 0 });
});
test("each AG Grid lens yields the same underlying, never-mutated row identifiers", () => {
  const rows = data.map((x) => ({ id: x.id, proof: x }));
  assert.deepEqual(e(p.select(rows, "moved").map((r: any) => r.id)), ["paid", "corrected"]);
  assert.deepEqual(e(p.select(rows, "notMoved").map((r: any) => r.id)), ["refused", "partial"]);
  assert.deepEqual(e(p.select(rows, "corrected").map((r: any) => r.id)), ["corrected"]);
  assert.deepEqual(e(p.select(rows, "all").map((r: any) => r.id)), data.map((x) => x.id));
  assert.deepEqual(e(p.select(rows, "unexpected")), []);
  assert.equal(rows.length, 4, "filter cannot delete original receipts");
});
test("counterfeit properties are ignored: only true money_moved is counted", () => {
  const rows = p.entries([
    { receipt_id: "almost", money_moved: "true", corrections: "corrected" },
    { receipt_id: "yes", money_moved: true, corrections: [] },
  ], []);
  assert.deepEqual(e(p.counts(rows)), { total: 2, moved: 1, notMoved: 1, corrected: 0 });
});
