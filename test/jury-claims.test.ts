import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("jury README accurately distinguishes mandatory human release and signed scoped autonomy", () => {
  const readme = read("../README.md");
  assert.match(readme, /required human release OR valid signed grant/);
  assert.match(readme, /previously human-signed, still-valid grant/);
  assert.match(readme, /Mandate and grant permissions are checked again immediately before capture/);
  assert.doesNotMatch(readme, /capture only after a person's release/);
  assert.doesNotMatch(readme, /LOCK 3\s+a person releases in ANIMA/);
});

test("jury claims do not turn a developer-operated PayPal sandbox login into an independent payer test", () => {
  const readme = read("../README.md");
  assert.match(readme, /author \(not an independent test participant\)/);
  assert.match(readme, /No real money or independent buyer is claimed/);
  const pkg = JSON.parse(read("../package.json")) as {description: string; license: string};
  assert.match(pkg.description, /human-signed scoped autonomy/);
  assert.equal(pkg.license, "Apache-2.0");
  assert.match(read("../LICENSE").slice(0,200), /Apache License/);
});
