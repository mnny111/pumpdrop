import {isRateLimited} from './rpc.mjs';
const safeReasons=new Set([
 'Transaction simulation failed','Simulation balances missing','Treasury reserve would be breached',
 'SOL debit exceeds limit','USDC output below requirement','USDC debit exceeds limit',
 'Recorded transaction failed; operator reconciliation required','On-chain transaction failed',
 'Transaction outcome unresolved or blockhash expired; reconcile recorded signature before retrying',
 'Interrupted pack generation; reconcile provider before resuming',
 'Pack purchase deadline too close; reconcile before continuing',
 'Fresh swap exceeds fee budget','Unexpected swap native balance change',
 'Pack availability or price changed after funding','Purchase exceeded tracked fee budget',
 'Provider refunded purchase','NFT delivery transaction failed','NFT ownership not verified in finalized delivery',
 'Unexpected swap instruction; operator review required','Invalid swap payer or route',
 'Priority fee exceeds 100000 lamports','Unexpected payment account','Pack payment or memo mismatch',
 'Pack payment amount mismatch','Pack memo mismatch','Pack memo missing','Unpaid pack identity mismatch',
 'Purchase already contains a treasury signature; reconcile before replacement',
 'Pack has payment or delivery activity; reconcile before replacement',
 'NFT ownership not verified in finalized delivery','Core asset ownership not verified','Core delivery slot missing'
]);
// Fixed messages and public signatures only. Never expose raw signed bytes, keys,
// RPC URLs or arbitrary provider error bodies in logs or command output.
export function operatorStatus(state,store){
 const job=state.job,reason=state.halted?.reason;
 const ids=[state.pendingFee,...(job?[job.id+':swap',job.id+':purchase']:[])].filter(Boolean);
 return {paused:Boolean(state.halted),reason:reason?(isRateLimited({message:reason})?'RPC rate limit':safeReasons.has(reason)?reason:'Unclassified failure; private operator review required'):null,
  stage:job?.stage|| (state.pendingFee?'fee-collection':'idle'),feeBudgetLamports:state.feeBudget,
  retryAt:state.retryAt||null,transactions:ids.map(id=>{const tx=store.tx(id);return tx?{id,signature:tx.signature,status:tx.status,finalized:Boolean(tx.finalized)}:{id,status:'not-signed'}})};
}
