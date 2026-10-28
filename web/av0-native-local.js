/* ANIMA x ASSO | private native WebGL, same-origin local experiment only.
 * No AV0 model/shader, provider credentials, foreign URLs or payment authority are in this module.
 * The private lab is mounted separately at /__av0_lab/ on a loopback-only demonstration server.
 */
(() => {
  "use strict";
  const params = new URLSearchParams(location.search);
  if ((location.hostname !== "127.0.0.1" && location.hostname !== "localhost") ||
      params.get("asso_presence_lab") !== "1" || params.get("av0_native") !== "1") return;
  const root = document.getElementById("asso-presence");
  const figure = root?.querySelector(".asso-presence__figure");
  const canvas = document.getElementById("asso-presence-canvas");
  const status = document.getElementById("asso-presence-status");
  if (!root || !figure || !canvas || !status) return;

  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)),
    b => b.toString(16).padStart(2, "0")).join("");
  const trustedPath = "/__av0_lab/av0_embed_private.html";
  const frame = document.createElement("iframe");
  frame.className = "asso-presence__native";
  frame.title = "Real AV0 private WebGL renderer";
  frame.referrerPolicy = "no-referrer";
  frame.setAttribute("aria-hidden", "true");
  frame.setAttribute("tabindex", "-1");
  frame.setAttribute("loading", "eager");
  frame.src = trustedPath + "?parent_origin=" +
    encodeURIComponent(location.origin) + "&nonce=" + nonce;
  figure.dataset.nativeAv0 = "true";
  figure.append(frame);

  let firstFrame = 0, lastFrame = 0, lastAt = 0, ready = false, messages = 0, errors = 0;
  const label = () => document.documentElement.lang.toLowerCase().startsWith("fr")
    ? "AV0 réel · rendu 3D privé autonome · aucun pouvoir de paiement"
    : "Real AV0 · autonomous private 3D renderer · no payment authority";

  function onMessage(event) {
    if (event.origin !== location.origin || event.source !== frame.contentWindow) return;
    const m = event.data;
    if (!m || m.type !== "ANIMA_AV0_PRIVATE_V1" || m.nonce !== nonce) return;
    if (m.state === "FAIL") {
      errors++; ready = false; root.hidden = true;
      return;
    }
    if (m.state !== "RENDERING" || m.privateModel !== true ||
        m.framing !== "ORIGINAL_AV0_CADRER_SCENE" ||
        !Number.isSafeInteger(m.frames) || !Number.isSafeInteger(m.eyes) ||
        !Number.isFinite(m.fps) || m.frames < 30 || m.eyes < 30 ||
        m.fps < 15 || m.fps > 240 || m.frames <= lastFrame) return;
    if (!ready) firstFrame = m.frames;
    ready = true; lastFrame = m.frames; lastAt = performance.now(); messages++;
    root.hidden = false;
    root.dataset.avatarSource = "actual-av0-private-native-iframe";
    status.textContent = label();
  }
  window.addEventListener("message", onMessage);
  const monitor = window.setInterval(() => {
    if (ready && performance.now() - lastAt > 3000) {
      ready = false; root.hidden = true;
    }
  }, 1000);
  const observer = typeof MutationObserver === "function"
    ? new MutationObserver(() => { if (ready) status.textContent = label(); })
    : null;
  observer?.observe(document.documentElement, {attributes:true, attributeFilter:["lang"]});
  // The real actor recedes on small screens once the verdict enters view.
  // Only presentation changes: the native iframe remains alive and cannot authorize actions.
  const theatre = document.getElementById("theatre");
  function updateProofReading() {
    const verdict = theatre?.querySelector(".verdict");
    const top = verdict?.getBoundingClientRect().top;
    figure.dataset.proofInView = verdict && !theatre.hidden &&
      Number.isFinite(top) && top <= window.innerHeight - 110 ? "true" : "false";
  }
  const proofObserver = theatre && typeof MutationObserver === "function"
    ? new MutationObserver(updateProofReading) : null;
  proofObserver?.observe(theatre, {childList:true, attributes:true, attributeFilter:["hidden"]});
  window.addEventListener("scroll", updateProofReading, {passive:true});
  window.addEventListener("resize", updateProofReading);
  updateProofReading();
  window.addEventListener("pagehide", () => {
    window.clearInterval(monitor);
    window.removeEventListener("message", onMessage);
    observer?.disconnect();
    proofObserver?.disconnect();
    window.removeEventListener("scroll", updateProofReading);
    window.removeEventListener("resize", updateProofReading);
  }, {once:true});
  window.__ANIMA_AV0_NATIVE_LOCAL = Object.freeze({
    metrics: () => Object.freeze({ready, messages, firstFrame, lastFrame, errors,
      privateOnly:true, source:"same-origin-local-native-webgl"})
  });
})();
