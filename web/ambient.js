/* ANIMA V15 ornamental ambience control. No payments, provider state, media or network. */
(() => {
  "use strict";
  const field = document.getElementById("anima-ambient");
  const button = document.getElementById("ambient-toggle");
  if (!field || !button) return;

  let manualPaused = false;
  const root = document.documentElement;
  function updateLabel() {
    const fr = root.lang.toLowerCase().startsWith("fr");
    const label = manualPaused
      ? (fr ? "Relancer le fond" : "Resume ambient background")
      : (fr ? "Figer le fond" : "Pause ambient background");
    button.textContent = label;
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-pressed", String(manualPaused));
    root.dataset.animaAmbientPaused = String(manualPaused);
  }
  button.addEventListener("click", () => {
    manualPaused = !manualPaused;
    updateLabel();
  });
  if (typeof MutationObserver !== "undefined") {
    const langObserver = new MutationObserver(updateLabel);
    langObserver.observe(root, { attributes: true, attributeFilter: ["lang"] });
  }
  updateLabel();
})();
