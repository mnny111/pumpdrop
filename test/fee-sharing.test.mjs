import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,PublicKey,TransactionInstruction,VersionedTransaction} from '@solana/web3.js';
import {PumpFees,treasuryShare} from '../backend/pump.mjs';
import {Store} from '../backend/store.mjs';
const mint=Keypair.generate().publicKey,treasury=Keypair.generate(),other=Keypair.generate().publicKey;
test('treasury can receive fees without being the launch wallet',()=>{
 const sharing={mint,admin:other,shareholders:[{address:treasury.publicKey,shareBps:7500},{address:other,shareBps:2500}]};
 assert.equal(treasuryShare(sharing,mint,treasury.publicKey),7500);
 assert.throws(()=>treasuryShare(sharing,mint,Keypair.generate().publicKey),/not a recipient/);
});
test('fee allocation rejects wrong mint, duplicates and invalid totals',()=>{
 for(const sharing of [
  {mint:other,shareholders:[{address:treasury.publicKey,shareBps:10000}]},
  {mint,shareholders:[{address:treasury.publicKey,shareBps:5000}]},
  {mint,shareholders:[{address:treasury.publicKey,shareBps:5000},{address:treasury.publicKey,shareBps:5000}]}
 ])assert.throws(()=>treasuryShare(sharing,mint,treasury.publicKey));
});
test('shared fee build uses permissionless distribution with treasury as payer',async()=>{
 const connection={getLatestBlockhash:async()=>({blockhash:Keypair.generate().publicKey.toBase58()})};
 const pump=new PumpFees(connection,treasury,mint);pump.inspect=async()=>({mode:'shared',total:10000000n});
 let calls=0;pump.sdk={buildDistributeCreatorFeesInstructions:async(m,options)=>{
  calls++;assert.ok(m.equals(mint));assert.ok(options.payer.equals(treasury.publicKey));
  return {instructions:[new TransactionInstruction({programId:new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),keys:[],data:Buffer.from('distribution-fixture')})]};
 }};
 const tx=VersionedTransaction.deserialize(Buffer.from(await pump.build(),'base64'));
 assert.equal(calls,1);assert.ok(tx.message.staticAccountKeys[0].equals(treasury.publicKey));
});
test('unused failed setup can rebind identity without deleting records',()=>{
 const db=new Store(':memory:');db.set('identity',{mint:'old',treasury:'old'});
 db.set('worker',{feeBudget:'0',history:[],daily:{},job:null,pendingFee:null});
 assert.doesNotThrow(()=>db.assertIdentity({mint:'new',treasury:'new'}));
 assert.equal(db.get('identity').mint,'old');db.close();
});
test('financial activity blocks automatic identity changes',()=>{
 for(const kind of ['funds','payment','job','history','snapshot']){
  const db=new Store(':memory:');db.set('identity',{mint:'old',treasury:'old'});
  if(kind==='payment')db.putTx('payment',{signature:'saved'});
  else if(kind==='snapshot')db.set('snapshot:draw',{holders:[]});
  else db.set('worker',kind==='funds'?{feeBudget:'1'}:kind==='job'?{job:{id:'one'}}:{history:[{id:'one'}]});
  assert.throws(()=>db.assertIdentity({mint:'new',treasury:'new'}),/different token or treasury/);
  assert.doesNotThrow(()=>db.assertIdentity({mint:'old',treasury:'old'}));db.close();
 }
});
