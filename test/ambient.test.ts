import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const js = readFileSync(new URL("../web/ambient.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../web/style.css", import.meta.url), "utf8");
const html = readFileSync(new URL("../web/index.html", import.meta.url), "utf8");

function boot(language: string, missing = false) {
  const root = { lang: language, dataset: {} as Record<string, string> };
  const listeners = new Map<string, () => void>();
  const attrs = new Map<string, string>();
  const button = {
    textContent: "",
    setAttribute(name: string, value: string) { attrs.set(name, value); },
    addEventListener(event: string, cb: () => void) { listeners.set(event, cb); },
  };
  let observer: () => void = () => {};
  class FakeObserver {
    constructor(callback: () => void) { observer = callback; }
    observe(_root: unknown, arg: { attributes: boolean; attributeFilter: string[] }) {
      assert.deepEqual(Array.from(arg.attributeFilter), ["lang"]);
    }
  }
  const map: Record<string, unknown> = { "anima-ambient": {}, "ambient-toggle": button };
  runInNewContext(js, { document: {
    getElementById(id: string) { return missing ? null : map[id]; },
    documentElement: root,
  }, MutationObserver: FakeObserver });
  return { root, attrs, button, click() { listeners.get("click")?.(); }, language(lang: string) { root.lang = lang; observer(); } };
}

test("ambient control starts accessible and translated without touching payment state", () => {
  const view = boot("fr");
  assert.equal(view.button.textContent, "Figer le fond");
  assert.equal(view.attrs.get("aria-pressed"), "false");
  assert.equal(view.root.dataset.animaAmbientPaused, "false");
  view.click();
  assert.equal(view.button.textContent, "Relancer le fond");
  assert.equal(view.attrs.get("aria-pressed"), "true");
  assert.equal(view.root.dataset.animaAmbientPaused, "true");
  view.language("en");
  assert.equal(view.button.textContent, "Resume ambient background");
  view.click();
  assert.equal(view.root.dataset.animaAmbientPaused, "false");
  assert.equal(view.attrs.get("aria-label"), "Pause ambient background");
});
test("absence of visual nodes leaves the page unchanged", () => {
  assert.doesNotThrow(() => boot("fr", true));
});
test("real DOM retains its decision and receipt hierarchy while ambient is purely decorative", () => {
  assert.match(html, /id="anima-ambient" aria-hidden="true"/);
  assert.match(html, /id="ambient-toggle" aria-pressed="false"/);
  assert.match(html, /<script src="ambient.js"><\/script>/);
  assert.match(css, /body\.busy \.anima-ambient::before/);
  assert.match(css, /body:has\(#theatre:not\(\[hidden\]\)\)/);
  assert.match(css, /body:has\(#drawer\[aria-hidden="false"\]\)/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(js, /fetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|location\.assign/i);
});
