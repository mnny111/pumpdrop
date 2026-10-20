import {VersionedTransaction,TransactionMessage,PublicKey,SystemProgram,ComputeBudgetProgram} from '@solana/web3.js';
import {TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID,ASSOCIATED_TOKEN_PROGRAM_ID,NATIVE_MINT,getAssociatedTokenAddressSync} from '@solana/spl-token';
import {validateRoute} from './swap-policy.mjs';
import bs58 from 'bs58';
export const USDC=new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const MEMO='MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
// USDC destination published in Collector Crypt's standard Solana API docs.
const CC_USDC='D9CEogjHA6CpS12F8St9zpSco7pQKJB5uR1RqDsuzQZk';
export function usdUnits(value){const s=String(value);if(!/^\d+(\.\d{1,6})?$/.test(s))throw Error('Invalid USDC amount');const [a,b='']=s.split('.');return BigInt(a)*1000000n+BigInt(b.padEnd(6,'0'))}
function validateAta(ix,wallet){
 const d=Buffer.from(ix.data),mint=ix.keys[3]?.pubkey;
 if(!(d.length===0||d.length===1&&[0,1].includes(d[0]))||!mint||(!mint.equals(USDC)&&!mint.equals(NATIVE_MINT))||!ix.keys[0]?.pubkey.equals(wallet)||!ix.keys[2]?.pubkey.equals(wallet)||!ix.keys[1]?.pubkey.equals(getAssociatedTokenAddressSync(mint,wallet))||!ix.keys[4]?.pubkey.equals(SystemProgram.programId)||!ix.keys[5]?.pubkey.equals(TOKEN_PROGRAM_ID))throw Error('Unexpected ATA instruction');
}
function validateCompute(message){
 let units=1400000n,price=0n;const seen=new Set();
 for(const ix of message.instructions){if(!ix.programId.equals(ComputeBudgetProgram.programId))continue;const d=Buffer.from(ix.data);
  if(seen.has(d[0]))throw Error('Duplicate compute budget instruction');seen.add(d[0]);
  if(d[0]===2&&d.length===5){units=BigInt(d.readUInt32LE(1));if(units<1n||units>1400000n)throw Error('Invalid compute limit');}
  else if(d[0]===3&&d.length===9)price=d.readBigUInt64LE(1);
  else throw Error('Unsupported compute budget instruction');
 }
 if((units*price+999999n)/1000000n>100000n)throw Error('Priority fee exceeds 100000 lamports');
}
export function validateSwap(message,{payer,cost,maxInput,slippage}){
 validateCompute(message);
 const wallet=new PublicKey(payer),wsol=getAssociatedTokenAddressSync(NATIVE_MINT,wallet);let route=false,funded=0n;
 for(const ix of message.instructions){const p=ix.programId.toBase58(),d=Buffer.from(ix.data);
  if(p==='JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'){if(route)throw Error('Multiple swap routes');validateRoute(ix,{payer,outputMint:USDC,cost,maxInput,slippage});route=true;continue}
  if(p===ComputeBudgetProgram.programId.toBase58())continue;
  if(p===ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()){validateAta(ix,wallet);continue;}
  if(p===SystemProgram.programId.toBase58()&&d.length===12&&d.readUInt32LE(0)===2&&ix.keys[0].pubkey.equals(wallet)&&ix.keys[1].pubkey.equals(wsol)){funded+=d.readBigUInt64LE(4);if(funded>BigInt(maxInput))throw Error('Excess wrapped SOL funding');continue;}
  if(p===TOKEN_PROGRAM_ID.toBase58()&&d.length===1&&d[0]===17&&ix.keys[0].pubkey.equals(wsol))continue;
  if(p===TOKEN_PROGRAM_ID.toBase58()&&d.length===1&&d[0]===9&&ix.keys[0].pubkey.equals(wsol)&&ix.keys[1].pubkey.equals(wallet)&&ix.keys[2].pubkey.equals(wallet))continue;
  throw Error('Unexpected swap instruction; operator review required');
 }
 if(!route||!message.payerKey.equals(wallet))throw Error('Invalid swap payer or route');
}
export function validatePurchase(message,{payer,price,memo}){
 validateCompute(message);
 if(!message.payerKey?.equals(new PublicKey(payer)))throw Error('Unexpected purchase payer');
 const source=getAssociatedTokenAddressSync(USDC,new PublicKey(payer)).toBase58();let paid=0n,memoFound=false;
 for(const ix of message.instructions){const program=ix.programId.toBase58(),d=Buffer.from(ix.data);
  if(program===MEMO){
   const text=d.toString('utf8');
   if(memoFound||![memo,memo+':open'].includes(text))throw Error('Pack memo mismatch');
   memoFound=true;continue;
  }
  if(program===ComputeBudgetProgram.programId.toBase58())continue;
  if(program===ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()){validateAta(ix,new PublicKey(payer));continue}
  if(program!==TOKEN_PROGRAM_ID.toBase58())throw Error('Unexpected Collector Crypt instruction');
  const checked=d[0]===12;if(!checked&&d[0]!==3)throw Error('Only token transfer is allowed in pack purchase');
  const from=ix.keys[0]?.pubkey.toBase58(),to=ix.keys[checked?2:1]?.pubkey.toBase58(),authority=ix.keys[checked?3:2]?.pubkey.toBase58();
  if(from!==source||to!==CC_USDC||authority!==payer||d.length!==(checked?10:9))throw Error('Unexpected payment account');
  if(checked&&(!ix.keys[1].pubkey.equals(USDC)||d[9]!==6))throw Error('Unexpected payment mint');paid+=d.readBigUInt64LE(1);
 }
 if(paid!==usdUnits(price))throw Error('Pack payment amount mismatch');
 if(!memoFound)throw Error('Pack memo missing');
}
export class Transactions{
 constructor(connection,signer,store){Object.assign(this,{connection,signer,store})}
 async decode(base64){const tx=VersionedTransaction.deserialize(Buffer.from(base64,'base64'));const lookups=tx.message.addressTableLookups||[];const tables=[];for(const x of lookups){const a=await this.connection.getAddressLookupTable(x.accountKey);if(!a.value)throw Error('Missing address lookup table');tables.push(a.value)}const message=TransactionMessage.decompile(tx.message,{addressLookupTableAccounts:tables});return {tx,message}}
 async execute(id,build,{validate,maxSolDebit,minUsdcCredit,maxUsdcDebit,minSolBalance=0n}={}){
  let record=this.store.tx(id);
  if(!record){const built=await build();const {tx,message}=await this.decode(built);if(validate)await validate(message);
   const treasury=this.signer.publicKey;const keys=tx.message.staticAccountKeys||tx.message.accountKeys;
   // Do not allow an external transaction to write unrelated treasury token accounts.
   const writable=[...new Map(message.instructions.flatMap(ix=>ix.keys.filter(k=>k.isWritable).map(k=>[k.pubkey.toBase58(),k.pubkey]))).values()];
   for(let i=0;i<writable.length;i+=100){const infos=await this.connection.getMultipleAccountsInfo(writable.slice(i,i+100),'confirmed');for(const info of infos){if(info&&[TOKEN_PROGRAM_ID.toBase58(),TOKEN_2022_PROGRAM_ID.toBase58()].includes(info.owner.toBase58())&&info.data.length>=165&&new PublicKey(info.data.subarray(32,64)).equals(treasury)){const mint=new PublicKey(info.data.subarray(0,32));if(!mint.equals(USDC)&&!mint.equals(NATIVE_MINT))throw Error('Transaction writes unrelated treasury assets')}}}
   if(!keys.slice(0,tx.message.header.numRequiredSignatures).some(k=>k.equals(treasury)))throw Error('Treasury is not a required signer');
   const usdc=getAssociatedTokenAddressSync(USDC,treasury),addresses=[treasury,usdc];
   const before=await this.connection.getMultipleAccountsInfo(addresses,'confirmed');
   tx.sign([this.signer]);const sim=await this.connection.simulateTransaction(tx,{sigVerify:true,commitment:'confirmed',accounts:{encoding:'base64',addresses:addresses.map(x=>x.toBase58())}});
   if(sim.value.err)throw Error('Transaction simulation failed');const after=sim.value.accounts;if(!after||!after[0])throw Error('Simulation balances missing');
   const amount=a=>a?Buffer.from(a.data[0],'base64').readBigUInt64LE(64):0n;
   const beforeUsdc=before[1]?before[1].data.readBigUInt64LE(64):0n;
   const solDebit=BigInt(before[0]?.lamports||0)-BigInt(after[0].lamports),usdcDelta=amount(after[1])-beforeUsdc;
   if(BigInt(after[0].lamports)<BigInt(minSolBalance))throw Error('Treasury reserve would be breached');
   if(maxSolDebit!==undefined&&solDebit>BigInt(maxSolDebit))throw Error('SOL debit exceeds limit');if(minUsdcCredit!==undefined&&usdcDelta<BigInt(minUsdcCredit))throw Error('USDC output below requirement');if(maxUsdcDebit!==undefined&&-usdcDelta>BigInt(maxUsdcDebit))throw Error('USDC debit exceeds limit');
   record={signature:bs58.encode(tx.signatures[0]),raw:Buffer.from(tx.serialize()).toString('base64'),blockhash:tx.message.recentBlockhash,status:'signed',createdAt:Date.now()};this.store.putTx(id,record);
  }
  if(record.status==='failed')throw Error('Recorded transaction failed; operator reconciliation required');
  if(record.status==='confirmed'&&record.finalized)return record;
  const status=(await this.connection.getSignatureStatuses([record.signature],{searchTransactionHistory:true})).value[0];
  if(status?.err){this.store.putTx(id,{...record,status:'failed'});throw Error('On-chain transaction failed')}
  if(status?.confirmationStatus==='finalized'){return this.store.putTx(id,{...record,status:'confirmed',finalized:true})}
  if(status?.confirmationStatus==='confirmed'||status?.confirmationStatus==='processed')return null;
  if(!(await this.connection.isBlockhashValid(record.blockhash,'confirmed')).value)throw Error('Transaction outcome unresolved or blockhash expired; reconcile recorded signature before retrying');
  // Re-broadcast ONLY the exact same signed transaction; never replace its blockhash.
  await this.connection.sendRawTransaction(Buffer.from(record.raw,'base64'),{skipPreflight:false,maxRetries:2});
  return null;
 }
 async confirmedMeta(signature){return this.connection.getTransaction(signature,{commitment:'finalized',maxSupportedTransactionVersion:0})}
}
