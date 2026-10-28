/* ANIMA x ASSO: native read-only visual receiver for an isolated localhost AV0 lab.
   Never ships an avatar asset, private URL, payment permission, or synthetic face.
   No network requests. In an ordinary hosted application, the section stays hidden. */
(() => {
  "use strict";
  const root = document.getElementById("asso-presence");
  const canvas = document.getElementById("asso-presence-canvas");
  if (!root || !canvas) return;
  const params = new URLSearchParams(location.search);
  const local = location.hostname === "127.0.0.1" || location.hostname === "localhost";
  if (!local || params.get("asso_presence_lab") !== "1") return;

  const WIDTH = 660, HEIGHT = 630;
  const ctx = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
  if (!ctx) return;
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  let frames = 0, rejected = 0, firstAt = 0, lastAt = 0, painted = false;
  const status = document.getElementById("asso-presence-status");
  let pending = false;
  const limit = (v, a, b) => Math.min(b, Math.max(a, v));
  const copy = Object.freeze({
    fr: {
      eyebrow: "ANIMA × ASSO · LABORATOIRE PRIVÉ",
      title: "Une présence pour comprendre.",
      boundary: "Jamais pour autoriser.",
      description: "Asso est à tes côtés pour rendre les faits compréhensibles. La décision, les autorisations et la preuve restent dans ANIMA.",
      aria: "Asso, la présence qui accompagne sans autoriser",
      status: "AV0 réel · lecture visuelle privée · aucun pouvoir de paiement"
    },
    en: {
      eyebrow: "ANIMA × ASSO · PRIVATE LAB",
      title: "A presence to understand.",
      boundary: "Never to authorize.",
      description: "Asso helps make the facts understandable. Decisions, permissions and evidence stay with ANIMA.",
      aria: "Asso, a companion who explains without authorizing",
      status: "Actual AV0 · private visual stream · no payment authority"
    }
  });
  function syncCopy() {
    const data = document.documentElement.lang.toLowerCase().startsWith("fr") ? copy.fr : copy.en;
    for (const [id, value] of [
      ["asso-presence-eyebrow", data.eyebrow],
      ["asso-presence-title", data.title],
      ["asso-presence-boundary", data.boundary],
      ["asso-presence-description", data.description],
    ]) {
      const element = document.getElementById(id);
      if (element) element.textContent = value;
    }
    if (typeof root.setAttribute === "function") root.setAttribute("aria-label", data.aria);
    if (painted && status) status.textContent = data.status;
  }
  if (typeof MutationObserver !== "undefined") {
    new MutationObserver(syncCopy).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
  }
  syncCopy();

  function paint(image) {
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    ctx.drawImage(image, 0, 0, WIDTH, HEIGHT);
    // The actual AV0 WebGL canvas has a black environment. Remove ONLY the black
    // outside the mesh, not the skin. Feather the exact silhouette anti-aliasing.
    const id = ctx.getImageData(0, 0, WIDTH, HEIGHT);
    const px = id.data;
    for (let i = 0; i < px.length; i += 4) {
      const max = Math.max(px[i], px[i + 1], px[i + 2]);
      const min = Math.min(px[i], px[i + 1], px[i + 2]);
      if (max < 11) px[i + 3] = 0;
      else if (max < 51 && max - min < 24) {
        px[i + 3] = Math.round(px[i + 3] * limit((max - 11) / 40, 0, 1));
      }
    }
    ctx.putImageData(id, 0, 0);
    // Feather the shoulders and bottom into ANIMA's paper. There is no hard
    // rectangle, no jaw crop, no photo, and no generated replacement rig.
    ctx.save();
    ctx.globalCompositeOperation = "destination-in";
    const radial = ctx.createRadialGradient(330, 250, 250, 330, 250, 485);
    radial.addColorStop(0, "#000");
    radial.addColorStop(0.75, "rgba(0,0,0,.98)");
    radial.addColorStop(1, "transparent");
    ctx.fillStyle = radial;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    // Source geometry reaches the left/right canvas limits at shoulder height.
    // A radial fade alone exposes two vertical knife cuts; soften both sides.
    const sides = ctx.createLinearGradient(0, 0, WIDTH, 0);
    sides.addColorStop(0, "transparent");
    sides.addColorStop(0.13, "#000");
    sides.addColorStop(0.87, "#000");
    sides.addColorStop(1, "transparent");
    ctx.fillStyle = sides;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    const bottom = ctx.createLinearGradient(0, 420, 0, HEIGHT);
    bottom.addColorStop(0, "#000");
    bottom.addColorStop(0.55, "rgba(0,0,0,.92)");
    bottom.addColorStop(1, "transparent");
    ctx.fillStyle = bottom;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.restore();
  }

  // Only an explicit local test can call this. Untrusted URLs/dimensions are
  // ignored. No provider state or money action is read from this media channel.
  function pushFrame(dataUrl) {
    if (typeof dataUrl !== "string" ||
        !/^data:image\/(?:webp|png);base64,[A-Za-z0-9+/=]+$/.test(dataUrl) ||
        dataUrl.length < 200 || dataUrl.length > 2_000_000 || pending) { rejected++; return false; }
    pending = true;
    const img = new Image();
    img.onload = () => {
      pending = false;
      if (img.naturalWidth !== WIDTH || img.naturalHeight !== HEIGHT) {
        rejected++;
        return;
      }
      if (!painted || !matchMedia("(prefers-reduced-motion: reduce)").matches) {
        paint(img);
        painted = true;
      }
      frames++;
      if (!firstAt) firstAt = performance.now();
      lastAt = performance.now();
      if (root.hidden) root.hidden = false;
      root.dataset.avatarSource = "actual-av0-private";
      syncCopy();
    };
    img.onerror = () => { pending = false; rejected++; };
    img.src = dataUrl;
    return true;
  }

  window.AnimaAssoPresence = Object.freeze({
    pushFrame,
    metrics: () => Object.freeze({ frames, rejected, firstAt, lastAt, painted, width: WIDTH, height: HEIGHT }),
  });
})();
