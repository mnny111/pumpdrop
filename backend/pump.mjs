import {OnlinePumpSdk,PUMP_SDK,canonicalPumpPoolPda,normalizeQuoteMint,feeSharingConfigPda} from '@pump-fun/pump-sdk';
import {PUMP_AMM_SDK} from '@pump-fun/pump-swap-sdk';
import {NATIVE_MINT,TOKEN_PROGRAM_ID} from '@solana/spl-token';
import {PublicKey,TransactionMessage,VersionedTransaction} from '@solana/web3.js';
export class PumpFees{
 constructor(connection,signer,mint){Object.assign(this,{connection,signer,mint:new PublicKey(mint)});this.sdk=new OnlinePumpSdk(connection)}
 async inspect(){const curve=await this.sdk.fetchBondingCurve(this.mint),creator=curve.creator;
  if(curve.isCashbackCoin||curve.isHolderReward)throw Error('Token routes fees to cashback/holder rewards, not the creator treasury');
  if(creator.equals(feeSharingConfigPda(this.mint)))throw Error('Fee-sharing token detected; this worker requires a direct creator treasury');
  if(!creator.equals(this.signer.publicKey))throw Error('Treasury signer is not the token creator');
  if(!normalizeQuoteMint(curve.quoteMint).equals(NATIVE_MINT))throw Error('This worker requires a SOL-quoted Pump.fun token');
  const poolInfo=await this.connection.getAccountInfo(canonicalPumpPoolPda(this.mint));const pool=poolInfo?PUMP_AMM_SDK.decodePool(poolInfo):null;
  if(pool&&!pool.coinCreator.equals(creator))throw Error('PumpSwap creator differs from treasury');
  const vault=BigInt((await this.sdk.getCreatorVaultBalanceBothPrograms(creator)).toString());
  return {curve,pool,creator,total:vault+BigInt(curve.creatorFee?.toString()||0)+BigInt(pool?.creatorFees?.toString()||0)};
 }
 async build(){const {curve,pool,creator}=await this.inspect();const opts={payer:this.signer.publicKey,mint:this.mint,quoteMint:NATIVE_MINT,quoteTokenProgram:TOKEN_PROGRAM_ID};const instructions=[];
  if(BigInt(curve.creatorFee?.toString()||0)>0n)instructions.push(await PUMP_SDK.sweepCreatorFeeInstruction({...opts,creator}));
  if(pool&&BigInt(pool.creatorFees?.toString()||0)>0n)instructions.push(await PUMP_SDK.sweepPoolCreatorFeeInstruction({...opts,coinCreator:creator}));
  instructions.push(...await this.sdk.collectCoinCreatorFeeV2Instructions(creator,NATIVE_MINT,TOKEN_PROGRAM_ID,this.signer.publicKey));
  const {blockhash}=await this.connection.getLatestBlockhash('confirmed');return Buffer.from(new VersionedTransaction(new TransactionMessage({payerKey:this.signer.publicKey,recentBlockhash:blockhash,instructions}).compileToV0Message()).serialize()).toString('base64');
 }
}
