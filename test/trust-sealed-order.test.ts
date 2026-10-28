// Regression: same-millisecond timestamps must not reorder human grants and later anomalies.
// The append-only, signed ledger index is the source of causal truth.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AnimaApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { Ledger } from "../src/ledger.ts";
import { merchantTrust } from "../src/trust.ts";
import type { PaymentReceipt } from "../src/receipt.ts";

const SEAT = "billing@design-tool.example";
const TIE = "2026-11-02T10:11:12.333Z";

async function signedExamples() {
  const app = new AnimaApp(loadConfig({}, "missing.env"));
  try {
    const run = await app.runScene(1);
    assert.equal(run.outcome, "awaiting_payer");
    app.approveAsPayer(run.pending_key!);
    const p = await app.release(run.pending_key!, "Studio Lumen");
    assert.equal(p.status, "COMPLETED");
    const good: PaymentReceipt = {...p, receipt_id:"p-1",created_at:TIE};
    const declined: PaymentReceipt = {
      ...p, receipt_id:"declined",created_at:TIE,status:"REFUSED",
      receipt_type:"REFUSAL_RECEIPT", money_moved:false, execution_started:false,
      findings:[{id:"DECLINED_BY_HUMAN",impact:"hold",message:"Declined by human."}],
    };
    return {good,declined};
  } finally {app.close();}
}

test("signed grant followed by refusal at identical millisecond MUST revoke autonomy",async()=>{
  const {good,declined}=await signedExamples();
  const l=new Ledger(null);
  l.append(good);
  l.appendGrant({merchant:SEAT,auto_release_cents:3000,by:"human",at:TIE,basis:[good.receipt_id]});
  l.append(declined);
  assert.equal(l.verify().ok,true);
  assert.deepEqual(l.sealedEntries().map(e=>e.seal.index),[0,1,2]);
  const r=merchantTrust(SEAT,5000,l.sealedEntries());
  assert.equal(r.granted_cents,0);
  assert.equal(r.last_anomaly?.reason,"DECLINED_BY_HUMAN");
  assert.deepEqual(r.curve.map(e=>e.why),["grant","reset"]);
});

test("same timestamps: earlier anomaly followed by new clean record and a later human grant stays valid",async()=>{
  const {good,declined}=await signedExamples();
  const l=new Ledger(null);
  l.append(declined);
  for(let i=0;i<3;i++) l.append({...good,receipt_id:"new-clean-"+i});
  l.appendGrant({merchant:SEAT,auto_release_cents:3000,by:"human",at:TIE,basis:["new-clean-0","new-clean-1","new-clean-2"]});
  const r=merchantTrust(SEAT,5000,l.sealedEntries());
  assert.equal(l.verify().ok,true);
  assert.equal(r.granted_cents,3000);
  assert.equal(r.streak,0);
  assert.deepEqual(r.curve.map(e=>e.why),["grant"]);
});

test("a golden-seam correction appended after grant at identical time revokes on the ledger's actual order",async()=>{
  const {good}=await signedExamples();
  const l=new Ledger(null);
  l.append(good);
  l.appendGrant({merchant:SEAT,auto_release_cents:3000,by:"human",at:TIE,basis:[good.receipt_id]});
  l.appendCorrection(good.receipt_id,{at:TIE,by:"human",field:"explanation",
    previous:good.explanation,replacement:"corrected facts",reason:"New invoice evidence"});
  const r=merchantTrust(SEAT,5000,l.sealedEntries());
  assert.equal(l.verify().ok,true);
  assert.equal(r.granted_cents,0);
  assert.equal(r.last_anomaly?.reason,"CORRECTED");
  assert.deepEqual(r.curve.map(e=>e.why),["grant","reset"]);
});
