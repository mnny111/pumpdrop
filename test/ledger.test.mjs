import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Keypair} from '@solana/web3.js';
import {ledgerPath} from '../backend/ledger.mjs';
import {Store} from '../backend/store.mjs';
import {loadConfig} from '../backend/config.mjs';
import {LiveWorker} from '../backend/worker.mjs';
const key=()=>Keypair.generate().publicKey.toBase58();
test('fresh mode ignores stale carryover authorization; legacy mode still guards mismatches',()=>{
 const mint=key();
 const config=loadConfig({MAIN_TOKEN_MINT:mint,TOKEN_LEDGER_MODE:'fresh',CARRYOVER_TO_TOKEN_MINT:'obsolete-setting'});
 assert.equal(config.carryoverToMint,'');assert.equal(config.ledgerMode,'fresh');
 assert.throws(()=>loadConfig({TOKEN_LEDGER_MODE:'typo'}),/TOKEN_LEDGER_MODE/);
 assert.equal(loadConfig({}).ledgerMode,'legacy');
 assert.throws(()=>loadConfig({MAIN_TOKEN_MINT:mint,CARRYOVER_TO_TOKEN_MINT:key()}),/must match/);
});
test('each token and treasury has its own stable ledger and invalid paths are rejected',()=>{
 const options={dataDir:tmpdir(),ledgerMode:'fresh',mint:key(),treasury:key()};
 const path=ledgerPath(options);
 assert.equal(ledgerPath({...options}),path);
 assert.notEqual(ledgerPath({...options,mint:key()}),path);
 assert.notEqual(ledgerPath({...options,treasury:key()}),path);
 assert.throws(()=>ledgerPath({...options,mint:'../../outside'}));
 assert.throws(()=>ledgerPath({...options,treasury:'../../outside'}));
});
test('new CA starts empty while old signed transactions, balances and paid packs remain archived',()=>{
 const dataDir=mkdtempSync(join(tmpdir(),'pumpcards-ledger-')),treasury=key(),mint=key();
 let legacy,newStore,reopened;
 try{
  legacy=new Store(ledgerPath({dataDir}));
  const original={feeBudget:'113182221',pendingFee:'old-claim',job:{id:'old-paid',stage:'open',winner:'old-winner'},daily:{'2026-10-20':'25000000'},history:[{id:'previous'}]};
  legacy.set('identity',{mint:key(),treasury});legacy.set('worker',original);legacy.putTx('old-claim',{status:'signed',raw:'saved-original-bytes',signature:'original-signature'});
  const options={dataDir,ledgerMode:'fresh',mint,treasury};
  newStore=new Store(ledgerPath(options));newStore.commitIdentity({mint,treasury});
  const w=new LiveWorker(loadConfig({MAIN_TOKEN_MINT:mint,TOKEN_LEDGER_MODE:'fresh'}));
  w.state=newStore.get('worker',w.state);
  assert.equal(w.state.feeBudget,'0');assert.equal(w.state.pendingFee,null);assert.equal(w.state.job,null);assert.deepEqual(w.state.history,[]);assert.deepEqual(w.state.daily,{});
  assert.equal(newStore.tx('old-claim'),null);
  assert.deepEqual(legacy.get('worker'),original);assert.equal(legacy.tx('old-claim').raw,'saved-original-bytes');
  // Restarting the same CA resumes its balance and transaction; "fresh" is not reset-on-boot.
  w.state.feeBudget='50000000';w.state.pendingFee='new-claim';newStore.set('worker',w.state);
  newStore.putTx('new-claim',{signature:'new-signature',status:'signed'});newStore.close();newStore=null;
  reopened=new Store(ledgerPath(options));
  assert.equal(reopened.get('worker').feeBudget,'50000000');assert.equal(reopened.tx('new-claim').signature,'new-signature');
  assert.deepEqual(legacy.get('worker'),original);
 }finally{
  legacy?.close();newStore?.close();reopened?.close();
  if(!dataDir.startsWith(join(tmpdir(),'pumpcards-ledger-')))throw Error('Unexpected test cleanup path');
  rmSync(dataDir,{recursive:true,force:true});
 }
});
