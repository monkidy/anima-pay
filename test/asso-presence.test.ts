import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const js = readFileSync(new URL("../web/asso-presence.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../web/index.html", import.meta.url), "utf8");

function boot(hostname, search, naturalWidth = 660) {
  const root = { hidden: true, dataset: {}, attributes: new Map<string, string>(),
    setAttribute(name: string, value: string) { this.attributes.set(name, value); } };
  const label = { textContent: "" };
  let painting = 0;
  const px = new Uint8ClampedArray(660 * 630 * 4);
  for(let i = 0; i < px.length; i += 4) {
    px[i]=196;px[i+1]=185;px[i+2]=172;px[i+3]=255;
  }
  const ctx = {
    clearRect() {}, drawImage() {}, save() {}, restore() {},
    getImageData() {return {data: px};},
    putImageData() { painting++; },
    createRadialGradient() { return { addColorStop() {} }; },
    createLinearGradient() { return { addColorStop() {} }; },
    fillRect() {},
  };
  const canvas = {getContext() {return ctx;}};
  const nodes = Object.fromEntries(["asso-presence-eyebrow", "asso-presence-title",
    "asso-presence-boundary", "asso-presence-description"].map(id => [id, { textContent: "" }]));
  const map={"asso-presence":root,"asso-presence-canvas":canvas,"asso-presence-status":label,...nodes};
  const docLang={lang:"fr"};
  let notifyLanguage = () => {};
  class LocalObserver {
    constructor(callback) { notifyLanguage=callback; }
    observe() {}
  }
  const window = {};
  class LabImage {
    naturalWidth = naturalWidth; naturalHeight = 630;
    set src(value) { if(!value.startsWith("data:image/")) throw Error("BAD_FRAME"); this.onload?.(); }
  }
  runInNewContext(js,{
    window,
    document:{ getElementById(id) {return map[id];}, documentElement:docLang},
    location:{hostname, search},
    URLSearchParams, Image:LabImage,
    performance:{now:()=>100},
    matchMedia:()=>({matches:false}),
    Uint8ClampedArray, MutationObserver:LocalObserver,
  });
  return {root, canvas, label, ctx, window, nodes,
    language(next) { docLang.lang=next; notifyLanguage(); },
    painted:()=>painting};
}
const data="data:image/png;base64,"+"A".repeat(400);
test("local AV0 presence copy translates FR to EN and back without changing payment authority", () => {
  const lab=boot("127.0.0.1","?asso_presence_lab=1");
  assert.equal(lab.nodes["asso-presence-title"].textContent,"Une présence pour comprendre.");
  assert.equal(lab.nodes["asso-presence-boundary"].textContent,"Jamais pour autoriser.");
  assert.equal(lab.label.textContent,"");
  lab.language("en");
  assert.equal(lab.nodes["asso-presence-title"].textContent,"A presence to understand.");
  assert.equal(lab.nodes["asso-presence-boundary"].textContent,"Never to authorize.");
  assert.match(lab.root.attributes.get("aria-label"),/without authorizing/);
  assert.equal(lab.window.AnimaAssoPresence.pushFrame(data),true);
  assert.equal(lab.label.textContent,"Actual AV0 · private visual stream · no payment authority");
  lab.language("fr");
  assert.equal(lab.nodes["asso-presence-title"].textContent,"Une présence pour comprendre.");
  assert.match(lab.label.textContent,/aucun pouvoir de paiement/);
  assert.equal(lab.root.dataset.avatarSource,"actual-av0-private");
});
test("actual avatar receiver is absent on hosted ANIMA and on local normal mode", () => {
  assert.equal(boot("anima-demo.onrender.com","?asso_presence_lab=1").window.AnimaAssoPresence, undefined);
  assert.equal(boot("127.0.0.1","").window.AnimaAssoPresence, undefined);
});
test("known-bad wrong size and untrusted frame URL fail closed", () => {
  const lab=boot("127.0.0.1","?asso_presence_lab=1",440);
  assert.equal(lab.window.AnimaAssoPresence.pushFrame("https://other.site/fake.png"),false);
  lab.window.AnimaAssoPresence.pushFrame(data);
  assert.equal(lab.root.hidden,true);
  assert.equal(lab.window.AnimaAssoPresence.metrics().frames,0);
  assert.ok(lab.window.AnimaAssoPresence.metrics().rejected>=2);
});
test("true sized local frames become visible, no approval authority", () => {
  const lab=boot("127.0.0.1","?asso_presence_lab=1");
  assert.equal(lab.window.AnimaAssoPresence.pushFrame(data),true);
  assert.equal(lab.root.hidden,false);
  assert.equal(lab.root.dataset.avatarSource,"actual-av0-private");
  assert.equal(lab.window.AnimaAssoPresence.metrics().frames,1);
  assert.ok(lab.painted()>0);
  assert.match(lab.label.textContent,/aucun pouvoir de paiement/);
});
test("actual DOM receiver is placed inside the application", () => {
  assert.match(html,/id="asso-presence"/);
  assert.match(html,/id="asso-presence-canvas"/);
  assert.match(html,/<script src="asso-presence.js"><\/script>/);
  assert.doesNotMatch(js,/fetch\(|XMLHttpRequest|payPal|releaseOnce|capturePayment/i);
});
