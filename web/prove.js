// "Don't trust us, break it". Two proofs the visitor runs on their own session.
//   Chaos PayPal: they choose how the simulated PayPal fails, release a held refund, and see what is sealed.
//   Break the ledger: their browser verifies the sealed ledger itself (SHA-256 and Ed25519 in WebCrypto),
//   against the key fingerprint and signed head it pinned on loading; they change a cent, a word, delete
//   or cut an entry, or re-sign everything with a key of their own, and see where the chain breaks.
// The checks are those of verifyChain in src/seal.ts, in the same order, with the same answers.
(function (root) {
  "use strict";
  const GENESIS = "0".repeat(64);
  const HEAD_SCHEMA = "anima.ledger_head.v0";
  const ED = { name: "Ed25519" };

  /** JSON with keys sorted at every depth, as src/seal.ts canonical(). */
  const canonical = (v) => {
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
    return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  };
  const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
  const unhex = (h) => Uint8Array.from(String(h).match(/../g) ?? [], (x) => parseInt(x, 16));
  const fromB64 = (s) => Uint8Array.from(atob(String(s)), (c) => c.charCodeAt(0));
  const toB64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
  const sha256 = async (subtle, s) => hex(await subtle.digest("SHA-256", new TextEncoder().encode(s)));
  /** The key's SPKI bytes, from the PUBLIC KEY block of its PEM, whatever surrounds it and however its lines end. */
  const der = (pem) => fromB64((/-----BEGIN PUBLIC KEY-----([\s\S]*?)-----END PUBLIC KEY-----/.exec(String(pem))?.[1] ?? "").replace(/\s+/g, ""));
  /** fingerprintOf in src/seal.ts: the full SHA-256 of the key's SPKI bytes. */
  const fingerprintOf = async (subtle, pem) => { try { return hex(await subtle.digest("SHA-256", der(pem))); } catch { return ""; } };
  /** A signature exactly as Node writes base64, or null: verifyChain refuses anything else too. */
  const strictB64 = (s) => { if (typeof s !== "string") return null; try { const b = fromB64(s); return toB64(b) === s ? b : null; } catch { return null; } };

  /** The ledger's key, or null when this browser's WebCrypto has no Ed25519 (signatures then go unchecked, and say so). */
  async function importKey(subtle, pem) {
    try { return await subtle.importKey("spki", der(pem), ED, false, ["verify"]); } catch { return null; }
  }
  async function signedBy(subtle, key, digestHex, sig) {
    const bytes = strictB64(sig);
    if (!bytes) return false;
    try { return await subtle.verify(ED, key, bytes, unhex(digestHex)); } catch { return false; }
  }

  /**
   * verifyChain, in the browser. anchor = { head, keyId }: the signed head and key fingerprint pinned when
   * the ledger was loaded. Returns verifyChain's answer plus `signatures` (whether Ed25519 was checked here).
   */
  async function verify(subtle, entries, pem, anchor) {
    const key = await importKey(subtle, pem);
    const keyId = await fingerprintOf(subtle, pem);
    const out = (r) => ({ ...r, signatures: key !== null, key_id: keyId });
    const broken = (index, reason, checked) => out({ ok: false, checked, broken: { index, reason } });
    if (anchor) {
      if (!anchor.head || typeof anchor.head !== "object") return broken(0, "HEAD_SIGNATURE", 0);
      const { sig, ...body } = anchor.head;
      if (body.key_id !== keyId || (anchor.keyId !== undefined && anchor.keyId !== keyId)) return broken(0, "KEY", 0);
      let signed = body.schema === HEAD_SCHEMA && strictB64(sig) !== null;
      if (signed && key) signed = await signedBy(subtle, key, await sha256(subtle, `${HEAD_SCHEMA}\n${canonical(body)}`), sig);
      if (!signed) return broken(0, "HEAD_SIGNATURE", 0);
    }
    let prev = GENESIS;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!entry || typeof entry !== "object" || !entry.seal || typeof entry.seal !== "object") return broken(i, "MISSING_SEAL", i);
      const { seal, ...body } = entry;
      if (seal.index !== i) return broken(i, "ORDER", i);
      if (seal.prev !== prev) return broken(i, "LINK", i);
      if (await sha256(subtle, `${prev}\n${canonical(body)}`) !== seal.hash) return broken(i, "HASH", i);
      if (key && !(await signedBy(subtle, key, seal.hash, seal.sig))) return broken(i, "SIGNATURE", i);
      prev = seal.hash;
    }
    if (!anchor) return out({ ok: true, checked: entries.length });
    const { count, head, key_id } = anchor.head;
    if (entries.length < count) return broken(entries.length, "TRUNCATED", entries.length);
    if ((count ? entries[count - 1].seal.hash : GENESIS) !== head) return broken(Math.max(count - 1, 0), "HEAD_MISMATCH", entries.length);
    return out({ ok: true, checked: entries.length, anchor: { count, head, key_id, beyond: entries.length - count } });
  }

  /** Whether this browser can check (and forge with) Ed25519. */
  async function ed25519(subtle) {
    try { await subtle.generateKey(ED, true, ["sign", "verify"]); return true; } catch { return false; }
  }

  /** The forger's attack: the same entries re-sealed and a new head signed, all with a key of their own. */
  async function forge(subtle, entries) {
    const kp = await subtle.generateKey(ED, true, ["sign", "verify"]);
    const pem = `-----BEGIN PUBLIC KEY-----\n${toB64(await subtle.exportKey("spki", kp.publicKey))}\n-----END PUBLIC KEY-----\n`;
    const kid = (await sha256(subtle, pem)).slice(0, 16);
    const fingerprint = await fingerprintOf(subtle, pem);
    const sign = async (digestHex) => toB64(await subtle.sign(ED, kp.privateKey, unhex(digestHex)));
    let prev = GENESIS;
    const out = [];
    for (let i = 0; i < entries.length; i++) {
      const { seal: _seal, ...body } = entries[i] ?? {};
      const hash = await sha256(subtle, `${prev}\n${canonical(body)}`);
      out.push({ ...body, seal: { index: i, prev, hash, sig: await sign(hash), key_id: kid } });
      prev = hash;
    }
    const head = { schema: HEAD_SCHEMA, key_id: fingerprint, count: out.length, head: prev, at: new Date().toISOString() };
    return { entries: out, publicKeyPem: pem, head: { ...head, sig: await sign(await sha256(subtle, `${HEAD_SCHEMA}\n${canonical(head)}`)) } };
  }

  /** The first amount in cents anywhere in an entry, as a path. */
  function centsPath(v, path = []) {
    if (!v || typeof v !== "object") return null;
    for (const [k, x] of Object.entries(v)) {
      if (k === "seal") continue;
      if (/_cents$/.test(k) && typeof x === "number") return [...path, k];
      const deeper = centsPath(x, [...path, k]);
      if (deeper) return deeper;
    }
    return null;
  }
  const at = (v, path) => path.reduce((o, k) => o[k], v);
  const setAt = (v, path, x) => { at(v, path.slice(0, -1))[path[path.length - 1]] = x; };

  /** One cent more. Returns what changed, or null when the entry carries no amount. */
  function addCent(entry) {
    const p = centsPath(entry);
    if (!p) return null;
    const was = at(entry, p);
    setAt(entry, p, was + 1);
    return { field: p.join("."), was, now: was + 1 };
  }

  /** One word: a sealed outcome turned into its opposite ("Unknown." becomes "Done."). */
  function changeWord(entry) {
    const field = typeof entry.explanation === "string" ? "explanation" : Object.keys(entry).find((k) => k !== "schema" && k !== "seal" && typeof entry[k] === "string");
    if (!field) return null;
    const was = entry[field];
    const NEGATIVE = /^(?:Not \w+|Unknown|Refused|Blocked)\.?/;
    const now = /^Done\b/.test(was) ? was.replace(/^Done\b/, "Refused") : NEGATIVE.test(was) ? was.replace(NEGATIVE, "Done.") : `Done. ${was}`;
    entry[field] = now;
    return { field, was, now };
  }

  root.animaProve = { canonical, verify, ed25519, forge, addCent, changeWord, fingerprintOf, sha256 };
  if (typeof document === "undefined") return;

  // ─── The section ─────────────────────────────────────────────────────────────────────────────────────
  const TEXT = {
    en: {
      jump: "Don't trust us. Break it →",
      eyebrow: "Don't trust us. Break it.",
      title: "One of you attacks PayPal, the other attacks the ledger. ANIMA holds, and tells the truth.",
      lede: "Two proofs you run yourself, on your own session, in under a minute. The checking happens in your browser, not on our word.",
      chaos_h: "1 · Make PayPal fail",
      chaos_p: "An agent asks to refund 12.50 EUR. The mandate holds it for a person: you. Choose what PayPal does, then release the refund.",
      chaos_sim: "Simulated PayPal tools of your session only: no call reaches PayPal, no money exists. These receipts are sealed in a lab ledger of their own and never count on the desk.",
      chaos_real: "The first case mirrors a real failure: on 29 October we observed PayPal's hosted tool server failing this way (paypal/agent-toolkit#119), and ANIMA's desk says so when it happens.",
      fault_not_sent: "Never sent", fault_not_sent_d: "PayPal's tool server fails before sending",
      fault_no_answer: "Sent, no answer", fault_no_answer_d: "the call left; nothing came back",
      fault_refused: "PayPal refuses", fault_refused_d: "PayPal answers no",
      fault_ok: "All goes well", fault_ok_d: "PayPal runs it",
      ask: "Let the agent ask for a refund",
      held: "Held for a person", release: "Release it",
      asks_left: "{n} refunds left in this lab", lab_reset: "Reset the lab",
      sealed_as: "Sealed as", counted: "Money counted:", counted_yes: "yes, in the simulator only", counted_no: "no",
      code_TOOL_NOT_SENT_BY_PAYPAL_TOOLS: "Not done. The (simulated) PayPal tool server failed before sending the call: nothing reached PayPal, and ANIMA does not call it a refusal.",
      code_TOOL_OUTCOME_UNKNOWN: "Unknown. The call left and no answer came back: it may have run. Check PayPal before any retry; nothing is counted.",
      code_TOOL_FAILED_AT_PAYPAL: "Not done. The simulated PayPal refused. Nothing is counted.",
      code_TOOL_DONE: "Done. The simulated PayPal ran the refund; counted as money moved in the simulator, never on the desk.",
      break_h: "2 · Break the ledger",
      break_p: "Your browser holds a copy of the sealed ledger. Change it any way you like; your browser checks it again, against the key fingerprint and the signed head it pinned when it loaded.",
      src_session: "Your session ({n})", src_chaos: "Chaos lab ({n})",
      load: "Load and pin", reload: "Load again and re-pin",
      pinned: "Pinned in your browser", fingerprint: "key fingerprint", head: "signed head (entries · last hash)",
      empty: "This ledger is empty. Release a refund above, or play a scene, then load it again.",
      a_cent: "+1 cent", a_word: "Change a word", a_delete: "Delete this entry", a_cut: "Cut the last entry", a_forge: "Re-sign everything with my own key", undo: "Undo my changes",
      edit: "Edit this entry yourself", apply: "Apply",
      changed: "You changed {field}: {was} → {now}", deleted: "You deleted entry {n}", cut: "You cut entry {n}, the last one", forged: "You re-signed all {n} entries and a new head with a key made in your browser",
      no_cents: "This entry carries no amount; try a word.", bad_json: "Not JSON: {e}",
      holds: "CHAIN_HOLDS: {n} entries; the signed head you pinned holds (key {k}…).",
      holds_beyond: "{b} written after your pin: covered by the chain, not by your head.",
      broken: "CHAIN_BROKEN at entry {i} ({r})",
      r_HASH: "Entry {i} is not what was signed.", r_LINK: "Entry {i} no longer follows the entry before it.", r_ORDER: "Entry {i} is not where it was sealed.",
      r_SIGNATURE: "Entry {i}'s signature is not the ledger key's.", r_MISSING_SEAL: "Entry {i} carries no seal.",
      r_KEY: "The ledger now names another key ({k}) than the one you pinned ({p}). Everything else may hold: that is what a forger re-signing it all looks like.",
      r_HEAD_SIGNATURE: "The signed head does not verify under this key.", r_TRUNCATED: "The head you pinned says {c} entries; entry {i} is gone.",
      r_HEAD_MISMATCH: "Entry {i} is no longer the one the head you pinned signed.",
      where_full: "Checked here, in your browser: SHA-256 of every entry, every link, every Ed25519 signature and the head's (WebCrypto). The ledger, its key and this page come from our server; the verdict is computed on your machine, and node scripts/verify-ledger.ts gives the same one.",
      where_partial: "This browser's WebCrypto has no Ed25519: it checked every hash, every link and the head you pinned, not the signatures. node scripts/verify-ledger.ts checks those.",
      guarantee_h: "Exactly what this proves",
      guarantee: "Every entry is exactly as the holder of the key you pinned signed it, in its place, and none has been changed, removed or cut since you pinned the head. It does not prove what was written is true, nor that the key is ours, nor what happened before you pinned: keep the fingerprint, and check any later copy against it. Entries written after your pin are chained, not anchored, until you pin again. This page and its verifier are served by the same host as the ledger; scripts/verify-ledger.ts checks the same thing without this page.",
      busy: "…", failed: "Could not reach your session: {e}", unverifiable: "NOT VERIFIED: this copy could not be checked",
    },
    fr: {
      jump: "Ne nous croyez pas. Cassez-le →",
      eyebrow: "Ne nous croyez pas. Cassez-le.",
      title: "L'un attaque PayPal, l'autre attaque le registre. ANIMA tient, et dit la vérité.",
      lede: "Deux preuves que vous lancez vous-même, sur votre propre session, en moins d'une minute. La vérification se fait dans votre navigateur, pas sur parole.",
      chaos_h: "1 · Faites tomber PayPal",
      chaos_p: "Un agent demande un remboursement de 12,50 €. Le mandat le retient pour une personne : vous. Choisissez ce que fait PayPal, puis débloquez le remboursement.",
      chaos_sim: "Outils PayPal simulés, propres à votre session : aucun appel n'atteint PayPal, aucun argent n'existe. Ces reçus sont scellés dans un registre de laboratoire à part et ne comptent jamais au bureau.",
      chaos_real: "Le premier cas reproduit une panne réelle : le 29 octobre, nous avons observé le serveur d'outils hébergé de PayPal échouer ainsi (paypal/agent-toolkit#119), et le bureau d'ANIMA le dit quand cela arrive.",
      fault_not_sent: "Jamais partie", fault_not_sent_d: "le serveur d'outils de PayPal échoue avant l'envoi",
      fault_no_answer: "Partie, sans réponse", fault_no_answer_d: "l'appel est parti, rien n'est revenu",
      fault_refused: "PayPal refuse", fault_refused_d: "PayPal répond non",
      fault_ok: "Tout va bien", fault_ok_d: "PayPal l'exécute",
      ask: "Laisser l'agent demander un remboursement",
      held: "Retenu pour une personne", release: "Débloquer",
      asks_left: "encore {n} remboursements dans ce laboratoire", lab_reset: "Remettre le laboratoire à zéro",
      sealed_as: "Scellé comme", counted: "Argent compté :", counted_yes: "oui, dans le simulateur seulement", counted_no: "non",
      code_TOOL_NOT_SENT_BY_PAYPAL_TOOLS: "Pas fait. Le serveur d'outils PayPal (simulé) a échoué avant d'envoyer l'appel : rien n'a atteint PayPal, et ANIMA ne l'appelle pas un refus.",
      code_TOOL_OUTCOME_UNKNOWN: "Inconnu. L'appel est parti et aucune réponse n'est revenue : il a peut-être été exécuté. Vérifier chez PayPal avant tout nouvel essai ; rien n'est compté.",
      code_TOOL_FAILED_AT_PAYPAL: "Pas fait. Le PayPal simulé a refusé. Rien n'est compté.",
      code_TOOL_DONE: "Fait. Le PayPal simulé a exécuté le remboursement ; compté comme argent parti dans le simulateur, jamais au bureau.",
      break_h: "2 · Cassez le registre",
      break_p: "Votre navigateur détient une copie du registre scellé. Modifiez-la comme vous voulez ; votre navigateur la vérifie de nouveau, contre l'empreinte de clé et la tête signée qu'il a épinglées au chargement.",
      src_session: "Votre session ({n})", src_chaos: "Laboratoire ({n})",
      load: "Charger et épingler", reload: "Recharger et épingler à nouveau",
      pinned: "Épinglé dans votre navigateur", fingerprint: "empreinte de la clé", head: "tête signée (entrées · dernière empreinte)",
      empty: "Ce registre est vide. Débloquez un remboursement ci-dessus, ou jouez une scène, puis rechargez-le.",
      a_cent: "+1 centime", a_word: "Changer un mot", a_delete: "Supprimer cette entrée", a_cut: "Couper la dernière entrée", a_forge: "Tout re-signer avec ma propre clé", undo: "Annuler mes changements",
      edit: "Modifier cette entrée vous-même", apply: "Appliquer",
      changed: "Vous avez changé {field} : {was} → {now}", deleted: "Vous avez supprimé l'entrée {n}", cut: "Vous avez coupé l'entrée {n}, la dernière", forged: "Vous avez re-signé les {n} entrées et une nouvelle tête avec une clé créée dans votre navigateur",
      no_cents: "Cette entrée ne porte aucun montant ; essayez un mot.", bad_json: "Pas du JSON : {e}",
      holds: "CHAIN_HOLDS : {n} entrées ; la tête signée que vous avez épinglée tient (clé {k}…).",
      holds_beyond: "{b} écrite(s) après votre épinglage : couvertes par la chaîne, pas par votre tête.",
      broken: "CHAIN_BROKEN at entry {i} ({r})",
      r_HASH: "L'entrée {i} n'est pas celle qui a été signée.", r_LINK: "L'entrée {i} ne suit plus l'entrée d'avant.", r_ORDER: "L'entrée {i} n'est plus à la place où elle a été scellée.",
      r_SIGNATURE: "La signature de l'entrée {i} n'est pas celle de la clé du registre.", r_MISSING_SEAL: "L'entrée {i} ne porte aucun sceau.",
      r_KEY: "Le registre nomme maintenant une autre clé ({k}) que celle que vous avez épinglée ({p}). Tout le reste peut tenir : c'est exactement l'allure d'un faussaire qui a tout re-signé.",
      r_HEAD_SIGNATURE: "La tête signée ne se vérifie pas sous cette clé.", r_TRUNCATED: "La tête que vous avez épinglée annonce {c} entrées ; l'entrée {i} a disparu.",
      r_HEAD_MISMATCH: "L'entrée {i} n'est plus celle que la tête épinglée a signée.",
      where_full: "Vérifié ici, dans votre navigateur : le SHA-256 de chaque entrée, chaque lien, chaque signature Ed25519 et celle de la tête (WebCrypto). Le registre, sa clé et cette page viennent de notre serveur ; le verdict est calculé sur votre machine, et node scripts/verify-ledger.ts rend le même.",
      where_partial: "Le WebCrypto de ce navigateur n'a pas Ed25519 : il a vérifié chaque empreinte, chaque lien et la tête épinglée, pas les signatures. node scripts/verify-ledger.ts les vérifie.",
      guarantee_h: "Ce que cela prouve, exactement",
      guarantee: "Chaque entrée est exactement telle que le détenteur de la clé épinglée l'a signée, à sa place, et aucune n'a été changée, retirée ou coupée depuis que vous avez épinglé la tête. Cela ne prouve pas que ce qui est écrit est vrai, ni que la clé est la nôtre, ni ce qui s'est passé avant votre épinglage : gardez l'empreinte et vérifiez toute copie ultérieure contre elle. Les entrées écrites après votre épinglage sont chaînées, pas ancrées, jusqu'au prochain épinglage. Cette page et son vérificateur sont servis par le même hôte que le registre ; scripts/verify-ledger.ts vérifie la même chose sans cette page.",
      busy: "…", failed: "Votre session ne répond pas : {e}", unverifiable: "NON VÉRIFIÉ : cette copie n'a pas pu être vérifiée",
    },
  };
  const lang = () => (document.documentElement.lang === "fr" ? "fr" : "en");
  const t = (k, vars = {}) => String(TEXT[lang()][k] ?? TEXT.en[k] ?? k).replace(/\{(\w+)\}/g, (_, x) => String(vars[x] ?? `{${x}}`));
  const h = (tag, props = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "onclick") n.addEventListener("click", v);
      else if (k === "ontoggle") n.addEventListener("toggle", v);
      else if (k === "oninput") n.addEventListener("input", v);
      else if (k === "text") n.textContent = v;
      else n.setAttribute(k, v === true ? "" : String(v));
    }
    for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) n.append(c);
    return n;
  };
  const short = (s, n = 70) => (String(s).length > n ? `${String(s).slice(0, n)}…` : String(s));
  const subtle = root.crypto && root.crypto.subtle;
  const FAULTS = ["not_sent", "no_answer", "refused", "ok"];

  const S = {
    fault: "not_sent", held: null, receipts: [], asksLeft: null, chaosBusy: false, chaosError: "",
    pinned: null, source: "session", copy: [], selected: 0, note: "", result: null, canEd: null, breakError: "", loaded: false,
    editOpen: false, guaranteeOpen: false, draft: null,
  };

  async function send(method, url, body) {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.error || res.statusText); e.status = res.status; throw e; }
    return data;
  }
  /** A session that expired (hosted: two hours) is opened again once, as app.js does. */
  async function api(method, url, body) {
    for (let tries = 0; ; tries++) {
      try { return await send(method, url, body); }
      catch (e) {
        if (e.status !== 401) throw e;
        // The page may still be opening its session (app.js); after that, reopen it once.
        if (tries < 3) { await new Promise((r) => setTimeout(r, 500)); continue; }
        if (tries === 3) { await send("POST", "/api/session", {}); continue; }
        throw e;
      }
    }
  }
  const takeLab = (r) => { S.held = r.held[0] ?? null; S.receipts = r.receipts; S.asksLeft = r.asks_left; };

  /** Loads both ledgers and pins their heads and key fingerprints; the copy under attack is a deep clone. */
  async function load(source) {
    const got = await api("GET", "/api/prove/ledgers");
    // The lab as the server holds it: a reload of the page finds its held refund and receipts again.
    takeLab(await api("GET", "/api/prove/chaos"));
    S.pinned = {};
    for (const k of ["session", "chaos"]) {
      const l = got[k];
      S.pinned[k] = { entries: l.entries, pem: l.publicKeyPem, head: l.head, keyId: await fingerprintOf(subtle, l.publicKeyPem) };
    }
    S.source = source ?? (S.pinned.session.entries.length || !S.pinned.chaos.entries.length ? "session" : "chaos");
    S.loaded = true;
    reset();
  }

  function reset() {
    const p = S.pinned[S.source];
    S.draft = null;
    S.copy = JSON.parse(JSON.stringify(p.entries));
    S.pem = p.pem;
    S.head = JSON.parse(JSON.stringify(p.head));
    S.selected = Math.max(S.copy.length - 1, 0);
    S.note = "";
    return check();
  }

  /** Never a stale verdict: the old one is gone before the check, and a check that cannot finish says so. */
  async function check() {
    const p = S.pinned[S.source];
    S.result = null;
    try {
      S.result = await verify(subtle, S.copy, S.pem, { head: S.head, keyId: p.keyId });
      S.result.pinnedKey = p.keyId;
    } catch (e) {
      S.result = { ok: false, error: e.message, signatures: false, key_id: "", pinnedKey: p.keyId };
    }
    render();
  }

  async function attack(kind) {
    S.breakError = "";
    S.draft = null;
    const e = S.copy[S.selected];
    if (kind === "cent" || kind === "word") {
      const d = e && (kind === "cent" ? addCent(e) : changeWord(e));
      if (!d) { S.note = kind === "cent" ? t("no_cents") : ""; return render(); }
      S.note = t("changed", { field: `#${S.selected} ${d.field}`, was: short(d.was, 48), now: short(d.now, 48) });
    } else if (kind === "delete") {
      if (!S.copy.length) return;
      S.copy.splice(S.selected, 1);
      S.note = t("deleted", { n: S.selected });
      S.selected = Math.min(S.selected, Math.max(S.copy.length - 1, 0));
    } else if (kind === "cut") {
      if (!S.copy.length) return;
      S.copy.pop();
      S.note = t("cut", { n: S.copy.length });
      S.selected = Math.max(S.copy.length - 1, 0);
    } else if (kind === "forge") {
      try {
        const f = await forge(subtle, S.copy);
        S.copy = f.entries; S.pem = f.publicKeyPem; S.head = f.head;
        S.note = t("forged", { n: f.entries.length });
      } catch (err) { S.note = err.message; }
    }
    await check();
  }

  async function chaos(path, body) {
    if (S.chaosBusy) return;
    S.chaosBusy = true; S.chaosError = ""; render();
    try {
      takeLab(await api("POST", path, body));
      // The receipt just sealed is now in the lab's ledger: load it, pin it, and offer it to break.
      if (path.endsWith("/release") || path.endsWith("/reset")) await load("chaos");
      // Released: the agent asks again at once, so the next case is one choice and one click away.
      if (path.endsWith("/release") && S.asksLeft > 0) takeLab(await api("POST", "/api/prove/chaos/ask"));
    } catch (e) { S.chaosError = t("failed", { e: e.message }); }
    finally { S.chaosBusy = false; render(); }
  }

  const entryLabel = (e) => {
    if (!e) return "";
    if (e.schema === "anima.tool_receipt.v0") return `${e.call?.tool ?? "tool"} · ${e.explanation_code ?? e.status}${e.provider?.endsWith("simulator") ? " · sim" : ""}`;
    if (e.schema === "anima.correction.v0") return `correction · ${e.field}`;
    if (e.schema === "anima.trust_grant.v0") return `trust grant · ${e.merchant}`;
    return `${e.receipt_type ?? "receipt"} · ${e.status ?? ""}${e.request?.invoice_number ? ` · ${e.request.invoice_number}` : ""}`;
  };

  function renderChaos() {
    const box = h("div", { class: "prove-body" },
      h("p", { text: t("chaos_p") }),
      h("p", { class: "prove-sim", text: t("chaos_sim") }),
      h("p", { class: "muted prove-small", text: t("chaos_real") }));
    const faults = h("div", { class: "prove-faults", role: "radiogroup", "aria-label": t("chaos_h") });
    for (const f of FAULTS) {
      faults.append(h("button", { type: "button", "data-k": `fault-${f}`, class: `prove-fault${S.fault === f ? " on" : ""}`, role: "radio", "aria-checked": String(S.fault === f),
        onclick: () => { S.fault = f; render(); } }, h("strong", { text: t(`fault_${f}`) }), h("span", { text: t(`fault_${f}_d`) })));
    }
    box.append(faults);
    if (S.held) {
      const amount = S.held.args?.amount;
      box.append(h("div", { class: "slip prove-held" },
        h("div", { class: "prove-held-line" }, h("code", { text: S.held.tool }), h("span", { text: `${amount?.value ?? ""} ${amount?.currency_code ?? ""}` }), h("span", { class: "pill hold", text: t("held") })),
        h("p", { class: "muted prove-small", text: S.held.reason }),
        h("button", { type: "button", class: "primary", "data-k": "chaos-main", disabled: S.chaosBusy, onclick: () => chaos("/api/prove/chaos/release", { call_id: S.held.call_id, fault: S.fault }) }, t("release"))));
    } else {
      box.append(h("button", { type: "button", class: "primary", "data-k": "chaos-main", disabled: S.chaosBusy || S.asksLeft === 0, onclick: () => chaos("/api/prove/chaos/ask") }, t("ask")));
    }
    if (S.chaosError) box.append(h("p", { class: "prove-error", role: "alert", text: S.chaosError }));
    const list = h("ol", { class: "prove-receipts", "aria-live": "polite" });
    for (const r of S.receipts) {
      const fail = r.status !== "COMPLETED";
      list.append(h("li", { class: fail ? (r.status === "PARTIAL" ? "hold" : "fail") : "pass" },
        h("div", { class: "prove-code" }, h("span", { class: "muted", text: `${t("sealed_as")} ` }), h("code", { text: r.explanation_code }), h("span", { class: "muted", text: ` · ${r.receipt_type} · ${r.status}` })),
        h("p", { text: t(`code_${r.explanation_code}`) }),
        h("p", { class: "prove-small" }, h("span", { class: "muted", text: `${t("counted")} ` }), h("strong", { text: r.money_moved ? t("counted_yes") : t("counted_no") }), h("span", { class: "muted", text: ` · provider ${r.provider}` }))));
    }
    box.append(list);
    if (S.asksLeft !== null) box.append(h("p", { class: "muted prove-small" }, t("asks_left", { n: S.asksLeft }), " · ",
      h("button", { type: "button", class: "ghost small", "data-k": "lab-reset", disabled: S.chaosBusy, onclick: () => { S.held = null; chaos("/api/prove/chaos/reset"); } }, t("lab_reset"))));
    return box;
  }

  function renderBreak() {
    const box = h("div", { class: "prove-body" }, h("p", { text: t("break_p") }));
    if (!S.loaded) {
      box.append(h("button", { type: "button", class: "primary", "data-k": "load", onclick: () => load().catch((e) => { S.breakError = t("failed", { e: e.message }); render(); }) }, t("load")));
      if (S.breakError) box.append(h("p", { class: "prove-error", role: "alert", text: S.breakError }));
      return box;
    }
    const src = h("div", { class: "proof-scopes prove-src", role: "group" });
    for (const k of ["session", "chaos"]) {
      src.append(h("button", { type: "button", "data-k": `src-${k}`, "aria-pressed": String(S.source === k), onclick: () => { S.source = k; reset(); } }, t(`src_${k}`, { n: S.pinned[k].entries.length })));
    }
    box.append(src);
    const p = S.pinned[S.source];
    box.append(h("p", { class: "prove-pin prove-small" }, h("span", { class: "muted", text: `${t("pinned")} · ${t("fingerprint")} ` }), h("code", { text: `${p.keyId.slice(0, 16)}…` }),
      h("span", { class: "muted", text: ` · ${t("head")} ` }), h("code", { text: `${p.head.count} · ${p.head.head.slice(0, 12)}…` })));
    if (!S.copy.length && !S.note) box.append(h("p", { class: "muted", text: t("empty") }));
    const list = h("ol", { class: "prove-entries", start: "0" });
    S.copy.forEach((e, i) => {
      list.append(h("li", {}, h("label", {}, h("input", { type: "radio", name: "prove-entry", "data-k": `entry-${i}`, checked: i === S.selected, onclick: () => { S.selected = i; render(); } }),
        h("span", { class: "prove-idx", text: `#${i}` }), h("span", { text: entryLabel(e) }))));
    });
    box.append(list);
    const acts = h("div", { class: "prove-attacks" },
      h("button", { type: "button", class: "ghost small", "data-k": "a-cent", disabled: !S.copy.length, onclick: () => attack("cent") }, t("a_cent")),
      h("button", { type: "button", class: "ghost small", "data-k": "a-word", disabled: !S.copy.length, onclick: () => attack("word") }, t("a_word")),
      h("button", { type: "button", class: "ghost small", "data-k": "a-delete", disabled: !S.copy.length, onclick: () => attack("delete") }, t("a_delete")),
      h("button", { type: "button", class: "ghost small", "data-k": "a-cut", disabled: !S.copy.length, onclick: () => attack("cut") }, t("a_cut")),
      S.canEd ? h("button", { type: "button", class: "ghost small", "data-k": "a-forge", disabled: !S.copy.length, onclick: () => attack("forge") }, t("a_forge")) : null,
      h("button", { type: "button", class: "small", "data-k": "undo", onclick: () => { S.draft = null; reset(); } }, t("undo")));
    box.append(acts);
    if (S.copy[S.selected]) {
      const area = h("textarea", { class: "prove-json", rows: "8", spellcheck: "false", "data-k": "json", "aria-label": t("edit"), oninput: (e) => { S.draft = { i: S.selected, text: e.target.value }; } });
      area.value = S.draft?.i === S.selected ? S.draft.text : JSON.stringify(S.copy[S.selected], null, 2);
      box.append(h("details", { class: "prove-edit", open: S.editOpen, ontoggle: (e) => { S.editOpen = e.target.open; } }, h("summary", { text: t("edit") }), area,
        h("button", { type: "button", class: "ghost small", "data-k": "apply", onclick: () => {
          try { S.copy[S.selected] = JSON.parse(area.value); S.draft = null; S.note = t("changed", { field: `#${S.selected}`, was: "JSON", now: "JSON" }); check(); }
          catch (e) { S.note = t("bad_json", { e: e.message }); render(); }
        } }, t("apply"))));
    }
    if (S.note) box.append(h("p", { class: "prove-note", text: S.note }));
    const r = S.result;
    if (r && r.error) {
      box.append(h("div", { class: "prove-verdict fail", role: "status" }, h("strong", { text: t("unverifiable") }), h("p", { text: r.error })));
    } else if (r) {
      const verdict = r.ok
        ? h("div", { class: "prove-verdict pass", role: "status" }, h("strong", { text: t("holds", { n: r.checked, k: r.key_id.slice(0, 16) }) }),
          r.anchor?.beyond ? h("p", { text: t("holds_beyond", { b: r.anchor.beyond }) }) : null)
        : h("div", { class: "prove-verdict fail", role: "status" }, h("strong", { text: t("broken", { i: r.broken.index, r: r.broken.reason }) }),
          h("p", { text: t(`r_${r.broken.reason}`, { i: r.broken.index, k: `${r.key_id.slice(0, 16)}…`, p: `${r.pinnedKey.slice(0, 16)}…`, c: S.head?.count ?? "" }) }));
      box.append(verdict, h("p", { class: "muted prove-small", text: r.signatures ? t("where_full") : t("where_partial") }));
    }
    box.append(h("button", { type: "button", class: "ghost small", "data-k": "reload", onclick: () => load(S.source).catch((e) => { S.breakError = t("failed", { e: e.message }); render(); }) }, t("reload")));
    if (S.breakError) box.append(h("p", { class: "prove-error", role: "alert", text: S.breakError }));
    return box;
  }

  function render() {
    const sec = document.getElementById("prove");
    if (!sec) return;
    const jump = document.getElementById("prove-jump");
    if (jump) jump.textContent = t("jump");
    const focused = sec.contains(document.activeElement) ? document.activeElement.getAttribute("data-k") : null;
    sec.replaceChildren(
      h("div", { class: "section-head" }, h("p", { class: "eyebrow", text: t("eyebrow") }), h("h2", { id: "prove-title", text: t("title") }), h("p", { class: "muted", text: t("lede") })),
      h("div", { class: "prove-grid" },
        h("article", { class: "panel prove-card", "aria-labelledby": "prove-chaos-h" }, h("h3", { id: "prove-chaos-h", text: t("chaos_h") }), renderChaos()),
        h("article", { class: "panel prove-card", "aria-labelledby": "prove-break-h" }, h("h3", { id: "prove-break-h", text: t("break_h") }), renderBreak())),
      h("details", { class: "prove-guarantee", open: S.guaranteeOpen, ontoggle: (e) => { S.guaranteeOpen = e.target.open; } }, h("summary", { text: t("guarantee_h") }), h("p", { text: t("guarantee") })));
    if (focused) sec.querySelector(`[data-k="${focused}"]`)?.focus();
  }

  function start() {
    if (!document.getElementById("prove") || !subtle) return;
    render();
    ed25519(subtle).then((ok) => { S.canEd = ok; render(); });
    // The page follows the language app.js sets on <html lang>.
    new MutationObserver(render).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
    // The ledgers load once the section is in view: by then the page has opened its session.
    const io = new IntersectionObserver((seen) => {
      if (!seen.some((x) => x.isIntersecting) || S.loaded) return;
      io.disconnect();
      load().catch((e) => { S.breakError = t("failed", { e: e.message }); render(); });
    });
    io.observe(document.getElementById("prove"));
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})(globalThis);
