import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair} from '@solana/web3.js';
import {createRpcFetch,isRateLimited} from '../backend/rpc.mjs';
import {LiveWorker} from '../backend/worker.mjs';
import {loadConfig} from '../backend/config.mjs';
import {Store} from '../backend/store.mjs';
import {Transactions} from '../backend/transactions.mjs';
import {operatorStatus} from '../backend/diagnostics.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('RPC queue spaces concurrent requests and respects Retry-After',async()=>{
 let now=0,calls=0;const times=[];
 const rpc=createRpcFetch({now:()=>now,sleep:async ms=>{now+=ms},fetchImpl:async()=>{
  times.push(now);return ++calls===1?new Response('',{status:429,headers:{'retry-after':'5'}}):new Response('{}');
 }});
 await Promise.all([rpc('https://rpc.invalid'),rpc('https://rpc.invalid')]);
 assert.deepEqual(times,[0,5000,5500]);
});
test('RPC sustained limits have bounded retries and sanitized errors',async()=>{
 let now=0,calls=0;
 const rpc=createRpcFetch({now:()=>now,sleep:async ms=>{now+=ms},fetchImpl:async()=>{calls++;return new Response('secret-provider-body',{status:429})}});
 await assert.rejects(rpc('https://rpc.invalid/?api-key=secret'),e=>isRateLimited(e)&&e.retryAfterMs===8000&&!e.message.includes('secret'));
 assert.equal(calls,3);
});
test('long Retry-After pauses without sending further RPC calls',async()=>{
 let calls=0;const rpc=createRpcFetch({now:()=>0,fetchImpl:async()=>{calls++;return new Response('',{status:429,headers:{'retry-after':'120'}})}});
 await assert.rejects(rpc('https://rpc.invalid'),e=>e.retryAfterMs===120000);
 await assert.rejects(rpc('https://rpc.invalid'),e=>e.retryAfterMs===120000);
 assert.equal(calls,1);
});
function worker(){
 const w=new LiveWorker(loadConfig({}));w.store=new Store(':memory:');w.started=true;w.catalogAt=Date.now();w.config.maxSwapSol=1;
 w.state.feeBudget='1000000000';w.state.daily={'2026-10-20':'25000000'};
 w.state.job={id:'job',stage:'swap',winner:'fixed-winner',memo:'fixed-memo',cost:'25000000'};
 return w;
}
test('legacy 429 halt resumes saved job and accounts finalized delta once across restart',async()=>{
 const w=worker();w.state.halted={at:1,reason:'429 Too Many Requests: provider response'};
 w.store.putTx('job:swap',{signature:'same-signature',raw:'same-bytes',status:'confirmed',finalized:true});
 w.save();const original=structuredClone(w.state);
 await w.tick();assert.equal(w.state.halted,undefined);assert.ok(w.state.retryAt>Date.now());
 assert.equal(w.state.feeBudget,original.feeBudget);assert.deepEqual(w.state.job,original.job);assert.deepEqual(w.state.daily,original.daily);
 w.state.retryAt=0;w.save();
 const restarted=new LiveWorker(loadConfig({}));Object.assign(restarted,{store:w.store,started:true,catalogAt:Date.now(),state:w.store.get('worker')});restarted.config.maxSwapSol=1;
 restarted.transactions=new Transactions({},Keypair.generate(),w.store);restarted.nativeDelta=async signature=>{assert.equal(signature,'same-signature');return -100000000n};
 await restarted.tick();assert.equal(restarted.state.job.stage,'generate');assert.equal(restarted.state.feeBudget,'900000000');
 assert.equal(w.store.tx('job:swap').raw,'same-bytes');assert.equal(restarted.state.job.winner,'fixed-winner');
 assert.equal(w.store.get('worker').feeBudget,'900000000');w.store.close();
});
test('RPC outage after broadcasting resumes same bytes and never builds a replacement',async()=>{
 const db=new Store(':memory:');db.putTx('job',{signature:'fixed',raw:Buffer.from('fixed bytes').toString('base64'),blockhash:'hash',status:'signed'});
 let sends=0,finalized=false;const connection={
  getSignatureStatuses:async()=>({value:[finalized?{err:null,confirmationStatus:'finalized'}:null]}),
  isBlockhashValid:async()=>({value:true}),
  sendRawTransaction:async bytes=>{assert.equal(bytes.toString(),'fixed bytes');sends++;finalized=true;throw Error('429 Too Many Requests')}
 };
 const tx=new Transactions(connection,Keypair.generate(),db);
 await assert.rejects(tx.execute('job',()=>assert.fail('must not rebuild')),/429/);
 assert.equal((await tx.execute('job',()=>assert.fail('must not rebuild'))).finalized,true);
 assert.equal(sends,1);db.close();
});
test('repeated 429 persists cooldown without modifying balances, winner or transaction',async()=>{
 const w=worker();const job=structuredClone(w.state.job);
 w.advanceJob=async()=>{throw Error('429 Too Many Requests')};
 await w.tick();assert.equal(w.state.halted,undefined);assert.ok(w.state.retryAt>Date.now());assert.equal(w.state.feeBudget,'1000000000');assert.deepEqual(w.state.job,job);
 w.advanceJob=async()=>assert.fail('cooldown must skip operation');await w.tick();
 assert.equal(w.store.get('worker').retryAt,w.state.retryAt);w.store.close();
});
test('recovery refuses ambiguous generation, failed transactions and non-rate-limit halts',async()=>{
 for(const [stage,reason,failed] of [['generating','429 Too Many Requests',false],['swap','Transaction simulation failed',false],['purchase','429 Too Many Requests',true],['swap','Transaction outcome unresolved or blockhash expired; reconcile recorded signature before retrying',false]]){
  const w=worker();w.state.job.stage=stage;w.state.halted={reason};if(failed)w.store.putTx('job:purchase',{status:'failed'});
  await w.tick();assert.equal(w.state.halted.reason,reason);assert.equal(w.state.feeBudget,'1000000000');w.store.close();
 }
});
test('generation ambiguity remains halted even when the provider returns 429',async()=>{
 const w=worker();w.state.job.stage='generate';
 w.advanceJob=async()=>{w.state.job.stage='generating';w.save();throw Error('429 Too Many Requests')};
 await w.tick();assert.ok(w.state.halted);await w.tick();assert.ok(w.state.halted);w.store.close();
});
test('fee collection cooldown survives disk reopen and credits receipt only once',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'pumpcards-recovery-')),path=join(dir,'ledger.sqlite');
 let store=new Store(path);
 try{
  const w=new LiveWorker(loadConfig({}));Object.assign(w,{store,started:true,catalogAt:Date.now()});
  w.state.feeBudget='113193021';w.state.pendingFee='fees:saved';w.state.halted={reason:'429 Too Many Requests'};
  store.putTx('fees:saved',{status:'confirmed',finalized:true,signature:'receipt'});w.save();
  await w.tick();const cooldown=w.state.retryAt;store.close();store=new Store(path);
  const resumed=new LiveWorker(loadConfig({}));Object.assign(resumed,{store,started:true,catalogAt:Date.now(),state:store.get('worker')});
  assert.equal(resumed.state.retryAt,cooldown);assert.equal(resumed.state.feeBudget,'113193021');
  resumed.state.retryAt=0;resumed.transactions=new Transactions({},Keypair.generate(),store);let deltas=0;
  resumed.nativeDelta=async()=>{deltas++;return 50000000n};
  await resumed.tick();assert.equal(resumed.state.feeBudget,'163193021');assert.equal(resumed.state.pendingFee,null);
  resumed.state.nextRoundAt=Date.now()+60000;await resumed.tick();assert.equal(deltas,1);
  assert.equal(store.get('worker').feeBudget,'163193021');
 }finally{store.close();if(!dir.startsWith(join(tmpdir(),'pumpcards-recovery-')))throw Error('Unexpected test cleanup path');rmSync(dir,{recursive:true,force:true})}
});
test('operator diagnostics omit provider secrets and raw transaction bytes',()=>{
 const w=worker();w.state.halted={reason:'https://rpc.invalid/?api-key=private-value'};
 w.store.putTx('job:swap',{signature:'public-signature',status:'signed',raw:'private-signed-bytes'});
 const status=JSON.stringify(operatorStatus(w.state,w.store));
 assert.ok(status.includes('public-signature'));assert.ok(!status.includes('private-value'));assert.ok(!status.includes('private-signed-bytes'));w.store.close();
});
