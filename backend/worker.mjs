import {requireMainnet} from './network.mjs';
import {createRpcConnection,isRateLimited,isTransient} from './rpc.mjs';
import {operatorStatus} from './diagnostics.mjs';
import {openSync,closeSync,unlinkSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {loadTreasury} from './wallet.mjs';
import {Store} from './store.mjs';
import {CollectorClient,verifyDelivery,verifyUnpaidPack} from './collector.mjs';
import {PumpFees} from './pump.mjs';
import {Jupiter} from './jupiter.mjs';
import {Transactions,validatePurchase,validateSwap,usdUnits} from './transactions.mjs';
import {snapshotHolders,weightedPick} from './holders.mjs';
import {nextRoundAt,rankedPacks} from './rounds.mjs';
const lamports=n=>BigInt(Math.ceil(n*1e9));
export class LiveWorker{
 constructor(config){this.config=config;this.cc=new CollectorClient({key:config.ccKey});this.catalog=[];this.catalogAt=0;this.catalogError=null;this.busy=false;this.state={feeBudget:'0',job:null,history:[],daily:{},pendingFee:null,lastFeeAt:0,nextRoundAt:nextRoundAt()};this.message='Waiting for launch configuration';this.started=false}
 async init(){if(!this.config.enabled||this.config.missing.length)return;
  this.startupStage='storage';this.store=new Store(resolve(this.config.dataDir,'pumpdrop.sqlite'));this.lockPath=resolve(this.config.dataDir,'worker.lock');this.startupStage='lock';this.lock=openSync(this.lockPath,'wx');
  process.once('exit',()=>{try{closeSync(this.lock);unlinkSync(this.lockPath)}catch{}});
  this.state=this.store.get('worker',this.state);
  this.startupStage='wallet';this.signer=loadTreasury(this.config);
  this.startupStage='identity';const identity={mint:this.config.mint,treasury:this.signer.publicKey.toBase58()};this.store.assertIdentity(identity);
  this.startupStage='rpc';this.connection=createRpcConnection(this.config.rpc);await requireMainnet(this.connection);
  this.pump=new PumpFees(this.connection,this.signer,this.config.mint);this.transactions=new Transactions(this.connection,this.signer,this.store);this.jupiter=new Jupiter(this.config.jupKey);this.startupStage='collector';await this.cc.validateKey();this.startupStage='pump';await this.pump.inspect();this.store.set('identity',identity);this.started=true;this.startupStage=null;
 }
 save(){this.store.set('worker',this.state)}
 async recoverUnsignedMemoPause(){
  const j=this.state.job;
  if(this.state.halted?.reason!=='Pack payment or memo mismatch'||j?.stage!=='purchase')return false;
  if(j.payer!==this.signer.publicKey.toBase58()||BigInt(j.cost)!==usdUnits(j.price))throw Error('Unpaid pack identity mismatch');
  if(this.store.tx(j.id+':purchase'))return false;
  const swap=this.store.tx(j.id+':swap');
  if(!swap?.finalized||swap.status!=='confirmed'||swap.signature!==j.swapSignature)return false;
  const {tx,message}=await this.transactions.decode(j.transaction);
  validatePurchase(message,{payer:j.payer,price:j.price,memo:j.memo});
  const signerIndex=tx.message.staticAccountKeys.slice(0,tx.message.header.numRequiredSignatures).findIndex(k=>k.equals(this.signer.publicKey));
  if(signerIndex<0||!tx.signatures[signerIndex]?.every(b=>b===0))throw Error('Purchase already contains a treasury signature; reconcile before replacement');
  verifyUnpaidPack(await this.cc.status(j.memo),j);
  // No purchase was signed or broadcast. Retain the old checkout for audit,
  // then obtain a fresh provider-signed transaction without changing its blockhash.
  j.retiredPurchases=[...(j.retiredPurchases||[]),{memo:j.memo,transaction:j.transaction,retiredAt:Date.now(),reason:'unsigned-memo-format-recovery'}];
  j.stage='generate';delete j.memo;delete j.transaction;delete j.generatedAt;
  delete this.state.halted;delete this.state.retryAt;delete this.state.retryCount;
  this.save();this.message='Refreshing the unpaid pack checkout; existing swap and holder preserved';
  return true;
 }
 recoverRateLimitPause(){
  // Only migrate a known transport failure. Never clear validation failures,
  // ambiguous pack generation, failed transactions or expired signatures.
  if(!this.state.halted||!isRateLimited({message:this.state.halted.reason})||this.state.job?.stage==='generating')return false;
  const stage=this.state.job?.stage;
  if(stage&&!['swap','generate','purchase','open'].includes(stage))return false;
  const id=this.state.pendingFee||(stage==='swap'||stage==='purchase'?this.state.job.id+':'+stage:null);
  if(id&&this.store.tx(id)?.status==='failed')return false;
  this.state.recoveredRateLimitAt=Date.now();delete this.state.halted;
  this.state.retryAt=Date.now()+30000;this.save();
  return true;
 }
 async refreshCatalog(){try{this.catalog=await this.cc.machines();this.catalogAt=Date.now();this.catalogError=null}catch{this.catalogError='Collector Crypt catalogue unavailable'}}
 async nativeDelta(signature){const tx=await this.transactions.confirmedMeta(signature);if(!tx?.meta){const error=Error('Finalized transaction accounting not yet available');error.retryable=true;throw error;}if(tx.meta.err)throw Error('Finalized transaction failed');const keys=tx.transaction.message.staticAccountKeys||tx.transaction.message.accountKeys;const i=keys.findIndex(k=>k.equals(this.signer.publicKey));if(i<0)throw Error('Treasury missing from confirmed transaction');return BigInt(tx.meta.postBalances[i])-BigInt(tx.meta.preBalances[i])}
 async tick(){if(this.busy)return;this.busy=true;try{
  if(Date.now()-this.catalogAt>30000)await this.refreshCatalog();
  if(!this.started){this.message=this.config.missing.length?'Waiting for launch configuration':'Automatic opening is paused';return}
  if(this.state.retryAt>Date.now()){this.message='Provider cooldown; fees and current transaction are saved';return}
  if(await this.recoverUnsignedMemoPause())return;
  this.recoverRateLimitPause();
  if(this.state.halted){this.message='Worker paused for transaction reconciliation';if(!this.reportedHalt){console.error('Worker reconciliation:',JSON.stringify(operatorStatus(this.state,this.store)));this.reportedHalt=true}return}
  if(this.state.retryAt>Date.now()){this.message='Provider cooldown; fees and current transaction are saved';return}
  if(this.state.pendingFee){const id=this.state.pendingFee;if(!this.store.tx(id)&&BigInt(await this.connection.getBalance(this.signer.publicKey))<lamports(this.config.reserveSol)+lamports(.005)){this.message='Fund the creator wallet with SOL for the transaction reserve and collection fee';return;}const r=await this.transactions.execute(id,()=>this.pump.build(),{maxSolDebit:lamports(.005),minSolBalance:lamports(this.config.reserveSol)});if(!r){this.message='Confirming creator fee collection';return}const delta=await this.nativeDelta(r.signature);this.state.feeBudget=(BigInt(this.state.feeBudget)+delta>0n?BigInt(this.state.feeBudget)+delta:0n).toString();this.state.pendingFee=null;this.state.lastFeeAt=Date.now();this.save();return}
  if(this.state.job){await this.advanceJob();return}
  if(this.state.event?.endsAt>Date.now())return;
  if(Date.now()-this.state.lastFeeAt>60000){if(BigInt(await this.connection.getBalance(this.signer.publicKey))<lamports(this.config.reserveSol)+lamports(.005)){this.message='Fund the creator wallet with SOL for the transaction reserve and collection fee';return;}const p=await this.pump.inspect();if(p.total>lamports(.001)){this.state.pendingFee='fees:'+randomUUID();this.save();return}this.state.lastFeeAt=Date.now();this.save()}
  if(this.catalogError||Date.now()-this.catalogAt>60000){this.message='Waiting for current Collector Crypt availability';return}
  if(Date.now()<(this.state.nextRoundAt||0)){this.message='Collecting creator fees for the next 60-second round';return}
  this.state.nextRoundAt=nextRoundAt();this.save();
  const today=new Date().toISOString().slice(0,10),spent=BigInt(this.state.daily[today]||'0');
  const ranked=rankedPacks(this.catalog,{maxPackUsd:this.config.maxPackUsd,dailyRemaining:usdUnits(this.config.dailyUsd)-spent,history:this.state.history});
  if(!ranked.length){this.message='No available pack within spending limits; balance carries forward';return}
  if(BigInt(this.state.feeBudget)===0n){this.message='No creator fees yet; waiting for the next round';return}
  let pack,maximum;
  for(const candidate of ranked){const q=await this.jupiter.quote(usdUnits(candidate.price),this.config.slippage);const required=BigInt(q.otherAmountThreshold)+lamports(.01);if(required<=lamports(this.config.maxSwapSol)&&required<=BigInt(this.state.feeBudget)){pack=candidate;maximum=required;break}}
  if(!pack){this.message='Below the next pack threshold; balance carries into the next round';return}
  const cost=usdUnits(pack.price);
  const balance=BigInt(await this.connection.getBalance(this.signer.publicKey));if(balance<maximum+lamports(this.config.reserveSol)){this.message='Preserving treasury transaction reserve';return}
  const snap=await snapshotHolders(this.connection,this.config.mint,[this.signer.publicKey.toBase58(),...this.config.excluded],BigInt(this.config.minimum));const winner=weightedPick(snap.holders);const id=randomUUID();
  this.store.set('snapshot:'+id,snap);this.state.daily[today]=(spent+cost).toString();this.state.job={id,stage:'swap',packId:pack.id,code:pack.code,price:pack.price,cost:cost.toString(),payer:this.signer.publicKey.toBase58(),winner:winner.wallet,draw:winner,snapshotHash:snap.hash,snapshotSlot:snap.slot,createdAt:Date.now()};this.save();
 }catch(e){this.message='Integration paused; see operator status';this.lastError=e.message; // Never include secrets or full provider responses.
  // Ambiguous financial outcomes require reconciliation, never a fresh transaction.
  const retryable=this.state.job?.stage!=='generating'&&isTransient(e);
  if(retryable){this.state.retryCount=(this.state.retryCount||0)+1;this.state.retryAt=Date.now()+Math.max(Number(e.retryAfterMs)||0,Math.min(300000,15000*2**Math.min(this.state.retryCount,5)));this.save();this.message='Provider cooldown; fees and current transaction are saved';return}
  if(this.state.job||this.state.pendingFee){this.state.halted={at:Date.now(),reason:e.message};this.save();this.reportedHalt=false}
 }finally{this.busy=false}}
 async advanceJob(){const j=this.state.job;
  if(j.stage==='swap'){
   let allowance=BigInt(this.state.feeBudget)-lamports(.005);const max=lamports(this.config.maxSwapSol);if(allowance>max)allowance=max;
   const r=await this.transactions.execute(j.id+':swap',async()=>{const q=await this.jupiter.quote(j.cost,this.config.slippage);if(BigInt(q.otherAmountThreshold)+lamports(.005)>allowance)throw Error('Fresh swap exceeds fee budget');return this.jupiter.build(q,j.payer)},{validate:m=>validateSwap(m,{payer:j.payer,cost:j.cost,maxInput:allowance-lamports(.005),slippage:this.config.slippage}),minSolBalance:lamports(this.config.reserveSol),maxSolDebit:allowance,minUsdcCredit:j.cost,maxUsdcDebit:0n});
   if(!r){this.message='Converting collected creator fees to USDC';return}const delta=await this.nativeDelta(r.signature);if(delta>0n)throw Error('Unexpected swap native balance change');this.state.feeBudget=(BigInt(this.state.feeBudget)+delta).toString();j.swapSignature=r.signature;j.stage='generate';this.save();return;
  }
  if(j.stage==='generate'){
   const fresh=(await this.cc.machines()).find(p=>p.id===j.packId);if(!fresh?.available||usdUnits(fresh.price)!==BigInt(j.cost))throw Error('Pack availability or price changed after funding');
   j.stage='generating';this.save();const generated=await this.cc.generate({payer:j.payer,winner:j.winner,code:j.code});j.memo=generated.memo;j.transaction=generated.transaction;j.generatedAt=Date.now();j.stage='purchase';this.save();return;
  }
  if(j.stage==='generating')throw Error('Interrupted pack generation; reconcile provider before resuming');
  if(j.stage==='purchase'){
   if(!this.store.tx(j.id+':purchase')&&Date.now()-(j.generatedAt||j.createdAt)>90*60000)throw Error('Pack purchase deadline too close; reconcile before continuing');
   const r=await this.transactions.execute(j.id+':purchase',async()=>j.transaction,{validate:m=>validatePurchase(m,{payer:j.payer,price:j.price,memo:j.memo}),minSolBalance:lamports(this.config.reserveSol),maxSolDebit:lamports(.005),maxUsdcDebit:j.cost});
   if(!r){this.message='Confirming Collector Crypt purchase';return}const delta=await this.nativeDelta(r.signature);const remaining=BigInt(this.state.feeBudget)+delta;if(remaining<0n)throw Error('Purchase exceeded tracked fee budget');this.state.feeBudget=remaining.toString();j.purchaseSignature=r.signature;j.stage='open';j.startedAt=Date.now();delete j.transaction;this.save();return;
  }
  if(j.stage==='open'){
   this.message='Opening the community pack';const status=await this.cc.status(j.memo);if(status.pack?.refunded)throw Error('Provider refunded purchase');
   if(status.pack?.status!=='confirmed')return;
   verifyDelivery(status,j);
   const award=await this.cc.open(j.memo);if(award.code==='WAITING_FOR_WEBHOOK')return;if(!award.nft_address)throw Error('Provider returned no collectible');
   const delivery=verifyDelivery(await this.cc.status(j.memo),j);if(!delivery)return;
   const tx=await this.connection.getTransaction(delivery.signature,{commitment:'finalized',maxSupportedTransactionVersion:0});if(!tx)return;if(!tx.meta||tx.meta.err)throw Error('NFT delivery transaction failed');
   const keys=[...(tx.transaction.message.staticAccountKeys||tx.transaction.message.accountKeys),...(tx.meta.loadedAddresses?.writable||[]),...(tx.meta.loadedAddresses?.readonly||[])];if(!keys.some(k=>k.toBase58()===j.winner))throw Error('Winner absent from confirmed delivery');const delivered=(tx.meta.postTokenBalances||[]).some(b=>b.mint===delivery.mint&&b.owner===j.winner&&b.uiTokenAmount?.amount==='1');if(!delivered)throw Error('NFT ownership not verified in finalized delivery');if(award.nft_address!==delivery.mint)throw Error('NFT result mismatch');
   const content=award.nftWon?.content;const image=award.nftWon?.image||content?.links?.image||content?.files?.[0]?.uri||null;
   const e={id:j.id,sequence:this.state.history.length+1,packId:j.packId,startedAt:j.startedAt,revealAt:Date.now()+1500,endsAt:Date.now()+13500,winner:j.winner,snapshotSlot:j.snapshotSlot,snapshotHash:j.snapshotHash,draw:j.draw,memo:j.memo,purchaseSignature:j.purchaseSignature,deliverySignature:delivery.signature,pull:{name:content?.metadata?.name||'Collector Crypt collectible',image:image?.startsWith('https://')?image:null,icon:'◈',mint:delivery.mint}};
   this.state.history.push(e);this.state.job=null;this.state.event=e;this.save();this.message='Collectible delivered to the selected holder';
  }
 }
 publicState(){const now=Date.now(),live=this.state.event?.endsAt>now?this.state.event:null,j=this.state.job;let event=live;
  if(j?.stage==='open')event={id:j.id,sequence:this.state.history.length+1,packId:j.packId,startedAt:j.startedAt,revealAt:now+60000,endsAt:now+120000,pull:null};
  if(event)event={...event,pull:now>=event.revealAt?event.pull:null};
  return {mode:'live',status:this.state.halted?'paused':this.started?'active':!this.config.enabled?'disabled':'setup',retryAt:this.state.retryAt||null,jobStage:j?.stage||null,message:this.message,serverTime:now,nextRoundAt:this.started?this.state.nextRoundAt:nextRoundAt(now),roundSeconds:60,nextPack:event?.packId||j?.packId||null,funded:0,feeBudgetLamports:this.state.feeBudget,tokenMint:this.config.mint||null,missing:this.config.missing,enabled:this.config.enabled,event,history:this.state.history.filter(e=>e.revealAt<=now).slice(-16).reverse(),catalog:this.catalog,catalogAt:this.catalogAt,catalogError:this.catalogError};
 }
}
