import {OnlinePumpSdk,PUMP_SDK,canonicalPumpPoolPda,normalizeQuoteMint,feeSharingConfigPda,PUMP_FEE_PROGRAM_ID} from '@pump-fun/pump-sdk';
import {PUMP_AMM_SDK} from '@pump-fun/pump-swap-sdk';
import {NATIVE_MINT,TOKEN_PROGRAM_ID} from '@solana/spl-token';
import {PublicKey,TransactionMessage,VersionedTransaction} from '@solana/web3.js';
export function treasuryShare(config,mint,treasury){
 if(!config.mint.equals(mint))throw Error('Fee sharing config mint mismatch');
 const shares=config.shareholders;
 if(!Array.isArray(shares)||!shares.length||shares.some(s=>!Number.isInteger(s.shareBps)||s.shareBps<=0)||shares.reduce((n,s)=>n+s.shareBps,0)!==10000||new Set(shares.map(s=>s.address.toBase58())).size!==shares.length)throw Error('Invalid fee sharing allocation');
 const share=shares.find(s=>s.address.equals(treasury));
 if(!share)throw Error('Treasury wallet is not a recipient in the token fee sharing config');
 return share.shareBps;
}
export class PumpFees{
 constructor(connection,signer,mint){Object.assign(this,{connection,signer,mint:new PublicKey(mint)});this.sdk=new OnlinePumpSdk(connection)}
 async inspect(){const curve=await this.sdk.fetchBondingCurve(this.mint),creator=curve.creator;
  if(curve.isCashbackCoin||curve.isHolderReward)throw Error('Token routes fees to cashback/holder rewards, not the creator treasury');
  if(!normalizeQuoteMint(curve.quoteMint).equals(NATIVE_MINT))throw Error('This worker requires a SOL-quoted Pump.fun token');
  if(creator.equals(feeSharingConfigPda(this.mint))){
   const info=await this.connection.getAccountInfo(creator,'confirmed');
   if(!info||!info.owner.equals(PUMP_FEE_PROGRAM_ID))throw Error('Fee sharing config missing or invalid');
   const sharing=PUMP_SDK.decodeSharingConfig(info),shareBps=treasuryShare(sharing,this.mint,this.signer.publicKey);
   const available=await this.sdk.getMinimumDistributableFee(this.mint,this.signer.publicKey,{quoteMint:NATIVE_MINT,quoteTokenProgram:TOKEN_PROGRAM_ID,payer:this.signer.publicKey});
   return {mode:'shared',curve,creator,shareBps,total:available.canDistribute?BigInt(available.distributableFees.toString())*BigInt(shareBps)/10000n:0n};
  }
  if(!creator.equals(this.signer.publicKey))throw Error('Treasury signer is not the token creator or a configured fee sharing recipient');
  const poolInfo=await this.connection.getAccountInfo(canonicalPumpPoolPda(this.mint));const pool=poolInfo?PUMP_AMM_SDK.decodePool(poolInfo):null;
  if(pool&&!pool.coinCreator.equals(creator))throw Error('PumpSwap creator differs from treasury');
  const vault=BigInt((await this.sdk.getCreatorVaultBalanceBothPrograms(creator)).toString());
  return {curve,pool,creator,total:vault+BigInt(curve.creatorFee?.toString()||0)+BigInt(pool?.creatorFees?.toString()||0)};
 }
 async build(){const {mode,curve,pool,creator,total}=await this.inspect();const opts={payer:this.signer.publicKey,mint:this.mint,quoteMint:NATIVE_MINT,quoteTokenProgram:TOKEN_PROGRAM_ID};const instructions=[];
  if(mode==='shared'){
   if(total<=0n)throw Error('No distributable creator fees');
   const distribution=await this.sdk.buildDistributeCreatorFeesInstructions(this.mint,opts);
   instructions.push(...distribution.instructions);
  }else{
  if(BigInt(curve.creatorFee?.toString()||0)>0n)instructions.push(await PUMP_SDK.sweepCreatorFeeInstruction({...opts,creator}));
  if(pool&&BigInt(pool.creatorFees?.toString()||0)>0n)instructions.push(await PUMP_SDK.sweepPoolCreatorFeeInstruction({...opts,coinCreator:creator}));
  instructions.push(...await this.sdk.collectCoinCreatorFeeV2Instructions(creator,NATIVE_MINT,TOKEN_PROGRAM_ID,this.signer.publicKey));
  }
  const {blockhash}=await this.connection.getLatestBlockhash('confirmed');return Buffer.from(new VersionedTransaction(new TransactionMessage({payerKey:this.signer.publicKey,recentBlockhash:blockhash,instructions}).compileToV0Message()).serialize()).toString('base64');
 }
}
