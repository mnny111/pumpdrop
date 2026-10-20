import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../backend/store.mjs';
import {loadConfig} from '../backend/config.mjs';
const target='8n1bUSp2rmJZkLEqXzYZpwzCHTjRX3vZd1RjjsNGpump';
const identity={mint:target,treasury:'same-treasury'},options={carryoverToMint:target};
function setup(){
 const store=new Store(':memory:');
 store.set('identity',{mint:'previous-token',treasury:'same-treasury'});
 store.set('worker',{feeBudget:'113182221',daily:{'2026-10-20':'25000000'},pendingFee:null,
  job:{id:'paid',stage:'open',purchaseSignature:'paid-signature',winner:'original-holder',memo:'original-memo'},history:[],
  halted:{reason:'NFT ownership not verified in finalized delivery'}});
 store.putTx('paid:purchase',{signature:'paid-signature',status:'confirmed',finalized:true,raw:'existing-bytes'});
 store.set('snapshot:paid',{holders:[{wallet:'original-holder',amount:'100'}]});
 return store;
}
test('explicit same-treasury migration carries ledger and preserves paid pack winner, journal and daily spend',()=>{
 const s=setup();const before=s.get('worker');
 assert.equal(s.commitIdentity(identity,options),true);
 const after=s.get('worker');assert.equal(after.feeBudget,before.feeBudget);assert.deepEqual(after.daily,before.daily);
 assert.equal(after.job.winner,'original-holder');assert.equal(after.job.memo,'original-memo');assert.equal(after.job.stage,'open');assert.equal(after.job.tokenMint,'previous-token');
 assert.deepEqual(after.halted,before.halted);assert.equal(s.tx('paid:purchase').raw,'existing-bytes');assert.equal(s.get('snapshot:paid').holders[0].wallet,'original-holder');
 assert.deepEqual(s.get('identity'),identity);
 const audit=s.db.prepare("SELECT value FROM state WHERE id LIKE 'migration:%'").all();
 assert.equal(audit.length,1);assert.deepEqual(JSON.parse(audit[0].value).previousWorker,before);
 assert.equal(s.commitIdentity(identity,options),false);
 assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM state WHERE id LIKE 'migration:%'").get().n,1);s.close();
});
test('migration cannot silently change treasury or use an unrelated target authorization',()=>{
 const s=setup();
 for(const [next,opt] of [[identity,{}],[identity,{carryoverToMint:'another-token'}],[{...identity,treasury:'different'},options]]){
  assert.throws(()=>s.commitIdentity(next,opt),/different token or treasury/);
  assert.equal(s.get('identity').mint,'previous-token');assert.equal(s.get('worker').feeBudget,'113182221');
 }
 s.close();
});
test('pending fee claims, unfinished purchases and unfinalized payments block migration',()=>{
 for(const kind of ['fees','swap','generate','generating','purchase','unfinalized']){
  const s=setup(),w=s.get('worker');
  if(kind==='fees')w.pendingFee='old-fee-claim';
  else if(kind==='unfinalized')s.putTx('paid:purchase',{signature:'paid-signature',status:'confirmed',finalized:false});
  else w.job.stage=kind;
  s.set('worker',w);assert.throws(()=>s.commitIdentity(identity,options),/before token migration/);
  assert.equal(s.get('identity').mint,'previous-token');assert.equal(s.get('worker').feeBudget,'113182221');s.close();
 }
});
test('migration failure rolls back audit and worker provenance atomically',()=>{
 const s=setup(),before=s.get('worker');
 s.db.exec("CREATE TRIGGER reject_identity BEFORE UPDATE ON state WHEN OLD.id='identity' BEGIN SELECT RAISE(ABORT,'test failure'); END");
 assert.throws(()=>s.commitIdentity(identity,options),/test failure/);
 assert.deepEqual(s.get('worker'),before);assert.equal(s.get('identity').mint,'previous-token');
 assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM state WHERE id LIKE 'migration:%'").get().n,0);s.close();
});
test('completed history retains old token attribution while new identity selects new holders',()=>{
 const s=setup(),w=s.get('worker');w.history=[{id:'paid',winner:'original-holder'}];w.event={...w.history[0]};w.job=null;delete w.halted;s.set('worker',w);
 s.commitIdentity(identity,options);
 assert.equal(s.get('worker').history[0].tokenMint,'previous-token');assert.equal(s.get('worker').event.tokenMint,'previous-token');
 const c=loadConfig({MAIN_TOKEN_MINT:target,CARRYOVER_TO_TOKEN_MINT:target});
 assert.equal(c.mint,target);assert.equal(c.carryoverToMint,target);s.close();
});
test('carryover configuration must name the exact destination mint',()=>{
 assert.throws(()=>loadConfig({MAIN_TOKEN_MINT:target,CARRYOVER_TO_TOKEN_MINT:'not-a-public-address'}),/public Solana mint/);
 assert.throws(()=>loadConfig({MAIN_TOKEN_MINT:'11111111111111111111111111111111',CARRYOVER_TO_TOKEN_MINT:target}),/must match/);
});
