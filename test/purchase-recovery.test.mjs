import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,PublicKey,TransactionInstruction,TransactionMessage,VersionedTransaction} from '@solana/web3.js';
import {createTransferCheckedInstruction,getAssociatedTokenAddressSync} from '@solana/spl-token';
import {USDC,usdUnits,validatePurchase,Transactions} from '../backend/transactions.mjs';
import {verifyUnpaidPack} from '../backend/collector.mjs';
import {LiveWorker} from '../backend/worker.mjs';
import {loadConfig} from '../backend/config.mjs';
import {Store} from '../backend/store.mjs';
const MEMO=new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const payee=new PublicKey('D9CEogjHA6CpS12F8St9zpSco7pQKJB5uR1RqDsuzQZk');
function transaction(signer,{memo='cc-test:open',amount=25000000n,duplicate=false,signed=false}={}){
 const memoIx=new TransactionInstruction({programId:MEMO,keys:[],data:Buffer.from(memo)});
 const message=new TransactionMessage({payerKey:signer.publicKey,recentBlockhash:Keypair.generate().publicKey.toBase58(),instructions:[
  memoIx,...(duplicate?[memoIx]:[]),createTransferCheckedInstruction(getAssociatedTokenAddressSync(USDC,signer.publicKey),USDC,payee,signer.publicKey,amount,6)
 ]});
 const tx=new VersionedTransaction(message.compileToV0Message());if(signed)tx.sign([signer]);
 return {message,base64:Buffer.from(tx.serialize()).toString('base64')};
}
function setup(options={}){
 const w=new LiveWorker(loadConfig({}));w.store=new Store(':memory:');w.signer=Keypair.generate();w.started=true;w.catalogAt=Date.now();
 const job={id:'existing',stage:'purchase',payer:w.signer.publicKey.toBase58(),winner:Keypair.generate().publicKey.toBase58(),memo:'cc-test',code:'pokemon_25',packId:'starter',price:25,cost:'25000000',createdAt:Date.now()-3*3600000,swapSignature:'finalized-swap',transaction:transaction(w.signer,options).base64};
 w.state.job=job;w.state.feeBudget='113193021';w.state.daily={'2026-10-20':'25000000'};w.state.halted={reason:'Pack payment or memo mismatch'};
 w.store.putTx('existing:swap',{signature:'finalized-swap',status:'confirmed',finalized:true});
 w.transactions=new Transactions({},w.signer,w.store);
 const status={memo:job.memo,pack:{wallet:job.payer,pack_type:job.code,turbo_mode:false,token_mint:USDC.toBase58(),status:null,transaction_signature:null,webhook_received:null,refunded:null,refund_transaction_signature:null},send:null,buyback:[]};
 w.cc={status:async()=>status};w.save();return {w,status};
}
test('purchase accepts exact Collector open suffix and legacy memo, rejects altered actions and amounts',()=>{
 const signer=Keypair.generate(),policy={payer:signer.publicKey.toBase58(),price:25,memo:'cc-test'};
 for(const memo of ['cc-test','cc-test:open'])validatePurchase(transaction(signer,{memo}).message,policy);
 for(const memo of ['cc-test:buyback','cc-test:open-extra','other:open','prefix-cc-test:open'])assert.throws(()=>validatePurchase(transaction(signer,{memo}).message,policy),/memo/);
 assert.throws(()=>validatePurchase(transaction(signer,{duplicate:true}).message,policy),/memo/);
 assert.throws(()=>validatePurchase(transaction(signer,{amount:usdUnits(26)}).message,policy),/amount/);
});
test('unsigned legacy purchase refresh preserves finalized swap, fees, daily reservation and winner',async()=>{
 const {w}=setup();const original=structuredClone(w.state.job),daily=structuredClone(w.state.daily);
 await w.tick();assert.equal(w.state.halted,undefined);assert.equal(w.state.job.stage,'generate');
 assert.equal(w.state.feeBudget,'113193021');assert.deepEqual(w.state.daily,daily);assert.equal(w.state.job.winner,original.winner);assert.equal(w.state.job.swapSignature,original.swapSignature);
 assert.equal(w.state.job.retiredPurchases[0].transaction,original.transaction);assert.equal(w.state.job.retiredPurchases[0].memo,original.memo);
 let generations=0;
 w.cc.machines=async()=>[{id:'starter',price:25,available:true}];
 w.cc.generate=async args=>{generations++;assert.equal(args.winner,original.winner);assert.equal(w.store.get('worker').job.stage,'generating');return {memo:'cc-fresh',transaction:'fresh-unsigned'}};
 await w.tick();assert.equal(generations,1);assert.equal(w.state.job.stage,'purchase');assert.ok(w.state.job.generatedAt>Date.now()-1000);
 // Fresh generation timestamp prevents an old job age from blocking this unpaid replacement.
 w.transactions.execute=async id=>{assert.equal(id,'existing:purchase');return null};
 await w.tick();assert.equal(w.state.halted,undefined);assert.equal(generations,1);
 assert.equal(w.state.feeBudget,'113193021');assert.equal(w.store.tx('existing:swap').signature,'finalized-swap');w.store.close();
});
test('purchase recovery refuses any journaled purchase or missing finalized swap',async()=>{
 for(const mode of ['signed','failed','missing-swap']){
  const {w}=setup();
  if(mode==='missing-swap')w.store.putTx('existing:swap',{signature:'finalized-swap',status:'signed'});
  else w.store.putTx('existing:purchase',{status:mode,signature:'never-replace'});
  w.cc.status=async()=>assert.fail('must not contact provider');await w.tick();
  assert.ok(w.state.halted);assert.equal(w.state.job.stage,'purchase');assert.equal(w.state.feeBudget,'113193021');w.store.close();
 }
});
test('recovery rejects treasury-signed input and still rejects a wrong payment amount',async()=>{
 for(const options of [{signed:true},{amount:25000001n}]){
  const {w}=setup(options);w.cc.status=async()=>assert.fail('must not contact provider');await w.tick();
  assert.ok(w.state.halted);assert.equal(w.state.job.stage,'purchase');assert.equal(w.state.job.retiredPurchases,undefined);w.store.close();
 }
});
test('paid, refunded, mismatched or ambiguous provider records prevent checkout replacement',()=>{
 const {w,status}=setup();const j=w.state.job;verifyUnpaidPack(status,j);
 for(const patch of [{status:'confirmed'},{transaction_signature:'sig'},{refunded:true},{wallet:Keypair.generate().publicKey.toBase58()},{pack_type:'pokemon_250'},{turbo_mode:true},{token_mint:'wrong'},{webhook_received:true}]){
  assert.throws(()=>verifyUnpaidPack({...status,pack:{...status.pack,...patch}},j));
 }
 for(const patch of [{memo:'wrong'},{pack:null},{send:{}},{buyback:[{}]},{buyback:undefined}])assert.throws(()=>verifyUnpaidPack({...status,...patch},j));
 w.store.close();
});
test('rate-limited recovery status lookup keeps old checkout and honors cooldown',async()=>{
 const {w}=setup();let lookups=0;w.cc.status=async()=>{lookups++;throw Error('429 Too Many Requests')};
 await w.tick();assert.equal(w.state.job.memo,'cc-test');assert.equal(w.state.job.stage,'purchase');assert.ok(w.state.retryAt>Date.now());
 await w.tick();assert.equal(lookups,1);assert.equal(w.state.feeBudget,'113193021');w.store.close();
});
