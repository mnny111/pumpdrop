import test from 'node:test';
import assert from 'node:assert/strict';
import {PublicKey,Keypair} from '@solana/web3.js';
import bs58 from 'bs58';
import {CORE_PROGRAM,verifyOnChainDelivery} from '../backend/delivery.mjs';
import {LiveWorker} from '../backend/worker.mjs';
import {loadConfig} from '../backend/config.mjs';
import {Store} from '../backend/store.mjs';
// Addresses and TransferV1 layout from the actual public finalized delivery.
const asset='CTWL8T2Y98TGLjBrjSSsZghVdVwzYiSedd15Lg8mF33D';
const winner='Fs3ynaiv2BBaSTjKXKA1vMhC1HmEC5ebFkvNQJhDrdJc';
const delivery={signature:'delivery-signature',mint:asset};
function fixture(){
 const data=Buffer.concat([Buffer.from([1]),new PublicKey(winner).toBuffer(),Buffer.alloc(80)]);
 const info={owner:new PublicKey(CORE_PROGRAM),data};
 const tx={slot:459231859,meta:{err:null,postTokenBalances:[],loadedAddresses:{writable:[],readonly:[]}},transaction:{message:{accountKeys:[asset,CORE_PROGRAM,winner].map(k=>new PublicKey(k)),instructions:[{programIdIndex:1,accounts:[0,1,1,1,2,1,1],data:bs58.encode(Buffer.from([14,0]))}]}}};
 const connection={getTransaction:async(sig,options)=>{assert.equal(sig,delivery.signature);assert.equal(options.commitment,'finalized');return tx},getAccountInfo:async(key,options)=>{assert.equal(key.toBase58(),asset);assert.equal(options.commitment,'finalized');assert.equal(options.minContextSlot,tx.slot);return info}};
 return {tx,info,connection};
}
test('Core delivery verifies finalized TransferV1 and program-owned AssetV1 owner',async()=>{
 const {connection}=fixture();assert.equal(await verifyOnChainDelivery(connection,delivery,winner),true);
});
test('Core verification supports versioned loaded addresses and binary instruction data',async()=>{
 const {tx,connection}=fixture();
 tx.transaction.message={staticAccountKeys:[asset,CORE_PROGRAM].map(k=>new PublicKey(k)),compiledInstructions:[{programIdIndex:1,accountKeyIndexes:[0,1,1,1,2],data:new Uint8Array([14,0])}]};
 tx.meta.loadedAddresses.readonly=[new PublicKey(winner)];
 assert.equal(await verifyOnChainDelivery(connection,delivery,winner),true);
});
test('Core refuses spoofed program, wrong asset, wrong recipient, opcode and compression format',async()=>{
 for(const change of [
  f=>{f.tx.transaction.message.accountKeys[1]=Keypair.generate().publicKey},
  f=>{f.tx.transaction.message.instructions[0].accounts[0]=2},
  f=>{f.tx.transaction.message.instructions[0].accounts[4]=0},
  f=>{f.tx.transaction.message.instructions[0].data=bs58.encode(Buffer.from([13,0]))},
  f=>{f.tx.transaction.message.instructions[0].data=bs58.encode(Buffer.from([14,1]))},
  f=>{f.tx.transaction.message.instructions[0].data=bs58.encode(Buffer.from([14,0,1]))}
 ]){
  const f=fixture();change(f);await assert.rejects(verifyOnChainDelivery(f.connection,delivery,winner),/ownership not verified/);
 }
});
test('Core refuses incorrect current owner, account program, asset kind and short data',async()=>{
 for(const change of [
  f=>{f.info.owner=Keypair.generate().publicKey},
  f=>{f.info.data[0]=5},
  f=>{Keypair.generate().publicKey.toBuffer().copy(f.info.data,1)},
  f=>{f.info.data=Buffer.alloc(32)}
 ]){
  const f=fixture();change(f);await assert.rejects(verifyOnChainDelivery(f.connection,delivery,winner),/Core asset ownership/);
 }
});
test('missing finalized transaction waits; failed delivery cannot pass',async()=>{
 const f=fixture();assert.equal(await verifyOnChainDelivery({...f.connection,getTransaction:async()=>null},delivery,winner),false);
 f.tx.meta.err={InstructionError:[0,'failed']};await assert.rejects(verifyOnChainDelivery(f.connection,delivery,winner),/transaction failed/);
});
test('standard SPL collectible ownership remains supported',async()=>{
 const f=fixture();f.tx.meta.postTokenBalances=[{mint:asset,owner:winner,uiTokenAmount:{amount:'1'}}];
 f.connection.getAccountInfo=async()=>assert.fail('SPL proof does not use Core layout');
 assert.equal(await verifyOnChainDelivery(f.connection,delivery,winner),true);
});
test('saved Core ownership pause recovers paid pack without signing, spending or rerolling',async()=>{
 const f=fixture(),w=new LiveWorker(loadConfig({}));w.store=new Store(':memory:');w.started=true;w.catalogAt=Date.now();w.connection=f.connection;
 const job={id:'existing',stage:'open',memo:'cc-paid',packId:'starter',code:'pokemon_25',payer:Keypair.generate().publicKey.toBase58(),winner,purchaseSignature:'paid',startedAt:Date.now()};
 w.state.job=job;w.state.feeBudget='113182221';w.state.daily={'2026-10-20':'25000000'};
 w.state.halted={reason:'NFT ownership not verified in finalized delivery'};
 w.store.putTx('existing:purchase',{signature:'paid',status:'confirmed',finalized:true});
 const status={pack:{wallet:job.payer,pack_type:job.code,turbo_mode:false,status:'confirmed',transaction_signature:'paid'},send:{status:'confirmed',to_wallet:winner,nft_address:asset,transaction_signature:delivery.signature}};
 let resultReads=0;w.cc={status:async()=>status,open:async memo=>{assert.equal(memo,job.memo);resultReads++;return {nft_address:asset,nftWon:{content:{metadata:{name:'Delivered card'},links:{image:'https://example.com/card.png'}}}}},generate:async()=>assert.fail('never buy another pack')};
 w.transactions={execute:async()=>assert.fail('never spend again')};
 await w.tick();assert.equal(w.state.halted,undefined);assert.equal(w.state.job.winner,winner);assert.equal(resultReads,0);
 await w.tick();assert.equal(w.state.job,null);assert.equal(w.state.history.length,1);assert.equal(w.state.history[0].winner,winner);assert.equal(resultReads,1);
 assert.equal(w.state.feeBudget,'113182221');assert.equal(w.state.daily['2026-10-20'],'25000000');
 await w.tick();assert.equal(w.state.history.length,1);assert.equal(resultReads,1);w.store.close();
});
test('unrelated pause or unconfirmed purchase cannot trigger delivery recovery',async()=>{
 const w=new LiveWorker(loadConfig({}));w.store=new Store(':memory:');
 w.state.job={id:'existing',stage:'open',purchaseSignature:'paid'};w.state.halted={reason:'NFT ownership not verified in finalized delivery'};
 w.cc={status:async()=>assert.fail('must not bypass purchase check')};
 assert.equal(await w.recoverCoreDeliveryPause(),false);
 w.store.putTx('existing:purchase',{signature:'paid',status:'confirmed',finalized:true});
 w.state.halted.reason='NFT result mismatch';assert.equal(await w.recoverCoreDeliveryPause(),false);w.store.close();
});
