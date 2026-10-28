// One real deliberation per scene, with the model configured in the environment (ADVISOR_KIND,
// ADVISOR_MODEL, ADVISOR_API_KEY). Prints the three voices and checks the sealed chain. PayPal stays
// simulated unless sandbox credentials are configured. The key is read from the environment only.

import { AnimaApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";

const config = loadConfig();
if (!config.advisor) {
  console.log("NOT_CONFIGURED: set ADVISOR_KIND, ADVISOR_MODEL and ADVISOR_API_KEY (or ADVISOR_BASE_URL for a local model)");
  process.exit(2);
}
const app = new AnimaApp(config);
console.log(JSON.stringify(app.mode()));
for (const n of (process.argv.slice(2).length ? process.argv.slice(2) : ["5", "1", "6", "2", "3", "4"]).map(Number)) {
  const run = await app.runScene(n);
  console.log(`\n=== Scene ${n}: ${run.title} -> ${run.outcome}`);
  console.log(`proposer: ${run.advice.recommendation} read ${(run.advice.read.amount_cents / 100).toFixed(2)} ${run.advice.read.currency} | ${run.advice.reasons.join(" ")}`);
  console.log(`adversary: ${run.council.adversary.stance} | ${run.council.adversary.reasons.join(" ")}`);
  console.log(`verifier: ${run.council.verifier.stance} | ${run.council.verifier.reasons.join(" ")}`);
  console.log(`dissent: ${run.council.dissent}`);
}
console.log(`\nsealed chain: ${JSON.stringify(app.verifyLedger())}`);
