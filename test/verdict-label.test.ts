import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// A refusal is ANIMA doing its job. The badge must say so in both languages: a judge reading "FAIL" on a blocked
// attack takes it for a broken product (a private audit of the demo film, 30/10/2026).
const app = readFileSync(new URL("../web/app.js", import.meta.url), "utf8");

test("the verdict badge says refused, never fail, in English and in French", () => {
  const maps = [...app.matchAll(/(?<![A-Za-z_])verdict: \{ pass: "([^"]*)", hold: "([^"]*)", fail: "([^"]*)" \}/g)].map((m) => m.slice(1));
  assert.equal(maps.length, 2, "one verdict map per language");
  const [en, fr] = maps;
  assert.equal(en[2], "refused");
  assert.equal(fr[2], "refusé");
  for (const labels of maps) for (const label of labels) assert.doesNotMatch(label, /^fail$/i);
});

test("every badge goes through the translated label, the raw verdict code is never printed", () => {
  assert.match(app, /const verdictLabel = \(v\) => \(fr\(\) \? I18N\.fr\.verdict : I18N\.en\.verdict\)\[v\] \?\? v;/);
  assert.match(app, /function pill\(verdict\) \{ return el\("span", \{ class: `pill \$\{verdict\}` \}, verdictLabel\(verdict\)\); \}/);
});
