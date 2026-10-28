// Scene 5 with the configured model, month by month: each voice's stance, the release outcome, and
// the trust it leaves. Short output on purpose.

import { AnimaApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";

const app = new AnimaApp(loadConfig());
await app.runScene(1).then(async (r) => { if (r.pending_key) { app.approveAsPayer(r.pending_key); await app.release(r.pending_key, "Studio Lumen"); } });
const runs = await app.replayTrustStory("Studio Lumen");
for (const r of runs) {
  const cut = (s: string) => s.slice(0, 140);
  console.log(`${r.advice.read.invoice_number}: proposer ${r.advice.recommendation} | adversary ${r.council.adversary.stance} ${cut(r.council.adversary.reasons[0] ?? "")} | verifier ${r.council.verifier.stance} | receipt ${r.receipt?.status}`);
}
const t = app.trust("billing@design-tool.example");
console.log(`trust: streak ${t.streak}, granted ${t.granted_cents}, proposal ${JSON.stringify(t.proposal)}, last anomaly ${t.last_anomaly?.reason ?? "none"}`);
