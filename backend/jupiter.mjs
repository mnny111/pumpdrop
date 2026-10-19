import {requestJson} from './collector.mjs';
import {NATIVE_MINT} from '@solana/spl-token';
import {USDC} from './transactions.mjs';
export class Jupiter{
 constructor(key){this.key=key}
 async quote(amount,slippage){const q=await requestJson('https://api.jup.ag/swap/v1/quote?'+new URLSearchParams({inputMint:NATIVE_MINT.toBase58(),outputMint:USDC.toBase58(),amount:String(amount),swapMode:'ExactOut',slippageBps:String(slippage),restrictIntermediateTokens:'true'}),{key:this.key});
  if(q.inputMint!==NATIVE_MINT.toBase58()||q.outputMint!==USDC.toBase58()||q.swapMode!=='ExactOut'||BigInt(q.outAmount)!==BigInt(amount)||q.slippageBps!==slippage)throw Error('Unexpected swap quote');if(!Number.isFinite(Number(q.priceImpactPct))||Math.abs(Number(q.priceImpactPct))>0.01)throw Error('Swap price impact above 1%');return q;
 }
 async build(quote,payer){const r=await requestJson('https://api.jup.ag/swap/v1/swap',{key:this.key,body:{userPublicKey:payer,quoteResponse:quote,useSharedAccounts:true,wrapAndUnwrapSol:true,dynamicComputeUnitLimit:true,dynamicSlippage:false,prioritizationFeeLamports:{priorityLevelWithMaxLamports:{priorityLevel:'high',maxLamports:100000}}}});if(!r.swapTransaction||r.simulationError)throw Error('Swap construction failed');return r.swapTransaction}
}
