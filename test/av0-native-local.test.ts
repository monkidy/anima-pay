import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const js=readFileSync(new URL("../web/av0-native-local.js",import.meta.url),"utf8");
const html=readFileSync(new URL("../web/index.html",import.meta.url),"utf8");
const css=readFileSync(new URL("../web/style.css",import.meta.url),"utf8");

function boot(hostname: string,search: string) {
  const events = new Map<string, Function>();
  let monitor: Function = ()=>{};
  let now=100;
  const figure={dataset:{} as Record<string,string>,children:[] as any[],append(child:any){this.children.push(child);}};
  const root={hidden:true,dataset:{} as Record<string,string>,querySelector(sel:string){
    return sel===".asso-presence__figure" ? figure : null;
  }};
  const canvas={};
  const status={textContent:""};
  const elements:Record<string,any>={
    "asso-presence":root,"asso-presence-canvas":canvas,"asso-presence-status":status
  };
  const location={hostname,search,origin:"http://"+hostname+":5274"};
  const win:any={
    addEventListener(name:string,cb:Function){events.set(name,cb);},
    removeEventListener(name:string){events.delete(name);},
    setInterval(cb:Function,_ms:number){monitor=cb;return 6;},
    clearInterval() {}
  };
  class Observer {
    constructor(_cb:Function){}
    observe(){}
    disconnect(){}
  }
  const document={
    getElementById(id:string){return elements[id]??null;},
    documentElement:{lang:"fr"},
    createElement(tag:string){
      assert.equal(tag,"iframe");
      const node:any={className:"",title:"",src:"",attrs:{} as Record<string,string>,
        contentWindow:{},setAttribute(n:string,v:string){this.attrs[n]=v;}};
      return node;
    }
  };
  runInNewContext(js,{window:win,document,location,
    crypto:{getRandomValues(x:Uint8Array){x.fill(8);return x;}},
    URLSearchParams,encodeURIComponent,MutationObserver:Observer,
    Uint8Array,Array,Object,Number,performance:{now:()=>now}});
  return {root,figure,status,window:win,document,location,
    time(t:number){now=t;monitor();},
    emit(v:any,origin=location.origin,source:any=figure.children[0]?.contentWindow){
      events.get("message")?.({data:v,origin,source});
    }};
}
test("hosted ANIMA cannot enable private renderer even with query flags",()=>{
  const a=boot("anima.example.org","?asso_presence_lab=1&av0_native=1");
  assert.equal(a.figure.children.length,0);
  assert.equal(a.window.__ANIMA_AV0_NATIVE_LOCAL,undefined);
});
test("localhost does not start 3D without both explicit flags",()=>{
  for(const search of ["","?asso_presence_lab=1","?av0_native=1"]){
    assert.equal(boot("127.0.0.1",search).figure.children.length,0);
  }
});
test("same-origin native local activation is fail closed with origin/source/nonce and motion receipt",()=>{
 const a=boot("127.0.0.1","?asso_presence_lab=1&av0_native=1");
 assert.equal(a.figure.children.length,1);
 const f=a.figure.children[0];
 assert.ok(f.src.startsWith("/__av0_lab/av0_embed_private.html?"));
 assert.ok(f.src.includes("parent_origin=http%3A%2F%2F127.0.0.1%3A5274"));
 assert.equal(a.root.hidden,true);
 const nonce=f.src.split("&nonce=")[1];
 const good={type:"ANIMA_AV0_PRIVATE_V1",nonce,state:"RENDERING",
    frames:42,eyes:42,fps:57,privateModel:true,framing:"ORIGINAL_AV0_CADRER_SCENE"};
 a.emit({...good,nonce:"deadbeefdeadbeef"});assert.equal(a.root.hidden,true);
 a.emit(good,"http://127.0.0.1:9999");assert.equal(a.root.hidden,true);
 a.emit(good,a.location.origin,{});assert.equal(a.root.hidden,true);
 a.emit({...good,privateModel:false});assert.equal(a.root.hidden,true);
 a.emit({...good,frames:2,eyes:2});assert.equal(a.root.hidden,true);
 a.emit(good);
 assert.equal(a.root.hidden,false);
 assert.equal(a.root.dataset.avatarSource,"actual-av0-private-native-iframe");
 assert.equal(a.window.__ANIMA_AV0_NATIVE_LOCAL.metrics().messages,1);
 assert.match(a.status.textContent,/aucun pouvoir de paiement/);
 a.emit({...good,frames:62,eyes:62});assert.equal(a.window.__ANIMA_AV0_NATIVE_LOCAL.metrics().lastFrame,62);
 a.time(3200);
 assert.equal(a.root.hidden,true);
 a.emit({...good,frames:90,eyes:90});
 assert.equal(a.root.hidden,false);
 a.emit({...good,state:"FAIL",frames:91,eyes:91});
 assert.equal(a.root.hidden,true);
});
test("native iframe offers no payment authority and remains separate from legacy canvas",()=>{
 assert.match(html,/<script src="av0-native-local\.js"><\/script>/);
 assert.match(css,/\.asso-presence__figure\[data-native-av0="true"\] canvas \{ display: none; \}/);
 assert.doesNotMatch(js,/fetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|approveAsPayer|captureAuthorization|releasePayment|PAYPAL_CLIENT/i);
});
