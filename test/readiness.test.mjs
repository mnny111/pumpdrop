import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair} from '@solana/web3.js';
import {LiveWorker} from '../backend/worker.mjs';
import {loadConfig} from '../backend/config.mjs';
import {Store} from '../backend/store.mjs';

test('disabled opener is distinct from incomplete setup and a halted live job',()=>{
 const w=new LiveWorker(loadConfig({}));
 assert.equal(w.publicState().status,'disabled');
 w.config.enabled=true;assert.equal(w.publicState().status,'setup');
 w.started=true;assert.equal(w.publicState().status,'active');
 w.state.halted={};assert.equal(w.publicState().status,'paused');
});
test('bad mint and exclusion values name the setting without exposing its contents',()=>{
 assert.throws(()=>loadConfig({MAIN_TOKEN_MINT:'secret-placeholder'}),e=>e.message.includes('MAIN_TOKEN_MINT')&&!e.message.includes('secret-placeholder'));
 assert.throws(()=>loadConfig({EXCLUDED_HOLDERS:'secret-placeholder'}),e=>e.message.includes('EXCLUDED_HOLDERS')&&!e.message.includes('secret-placeholder'));
});
test('late finalized metadata is retryable and does not alter the fee ledger',async()=>{
 const w=new LiveWorker(loadConfig({}));w.transactions={confirmedMeta:async()=>null};
 await assert.rejects(w.nativeDelta('signature'),e=>e.retryable===true);
 assert.equal(w.state.feeBudget,'0');
});
test('low collection reserve waits without signing or permanently halting',async()=>{
 const w=new LiveWorker(loadConfig({}));w.store=new Store(':memory:');w.started=true;w.catalogAt=Date.now();w.state.pendingFee='fees:one';
 w.signer=Keypair.generate();w.connection={getBalance:async()=>1000};
 w.transactions={execute:async()=>assert.fail('must not sign')};
 await w.tick();
 assert.equal(w.state.pendingFee,'fees:one');assert.equal(w.state.halted,undefined);
 assert.match(w.message,/Fund the creator wallet/);w.store.close();
});
test('already signed collection is reconciled even when current reserve is low',async()=>{
 const w=new LiveWorker(loadConfig({}));w.store=new Store(':memory:');w.started=true;w.catalogAt=Date.now();w.state.pendingFee='fees:one';
 w.store.putTx('fees:one',{signature:'saved'});w.connection={getBalance:async()=>assert.fail('must reconcile journal first')};
 w.transactions={execute:async()=>({signature:'saved'})};w.nativeDelta=async()=>1000000n;
 await w.tick();assert.equal(w.state.pendingFee,null);assert.equal(w.state.feeBudget,'1000000');w.store.close();
});
