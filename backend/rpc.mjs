import {Connection} from '@solana/web3.js';

export function isRateLimited(error){
 return error?.code==='RPC_RATE_LIMIT'||error?.code===429||error?.status===429||/^(?:RPC rate limit cooldown$|429\b|Server responded with 429\b|Provider request failed \(429\))/.test(error?.message||'');
}
export function isTransient(error){
 return isRateLimited(error)||error?.retryable===true||['TimeoutError','AbortError'].includes(error?.name)||/^(?:UND_ERR_|ECONNRESET$|ETIMEDOUT$|EAI_AGAIN$)/.test(error?.cause?.code||'');
}
// Share one queue across SDK calls and full holder snapshots. Never log endpoint URLs.
export function createRpcFetch({fetchImpl=fetch,now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),intervalMs=500}={}){
 let queue=Promise.resolve(),nextAt=0;
 return (url,options={})=>{
  const run=async()=>{
   for(let attempt=0;attempt<3;attempt++){
    const wait=nextAt-now();
    if(wait>30000){const e=Error('RPC rate limit cooldown');e.code='RPC_RATE_LIMIT';e.retryable=true;e.retryAfterMs=wait;throw e}
    if(wait>0)await sleep(wait);
    nextAt=now()+intervalMs;
    const signal=options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000);
    const response=await fetchImpl(url,{...options,signal});
    if(response.status!==429&&response.status<500)return response;
    const retry=response.headers?.get('retry-after');
    const requested=retry?(/^\d+(\.\d+)?$/.test(retry)?Number(retry)*1000:Date.parse(retry)-now()):0;
    const delay=Math.max(2000*2**attempt,Number.isFinite(requested)?requested:0);
    nextAt=now()+delay;
    await response.body?.cancel();
    if(attempt===2||delay>30000){
     const e=Error(response.status===429?'RPC rate limit cooldown':'RPC temporarily unavailable');
     e.code=response.status===429?'RPC_RATE_LIMIT':'RPC_UNAVAILABLE';e.retryable=true;e.retryAfterMs=delay;throw e;
    }
   }
  };
  const result=queue.then(run);queue=result.catch(()=>{});return result;
 };
}
export function createRpcConnection(url){
 const rpcFetch=createRpcFetch();
 const connection=new Connection(url,{commitment:'confirmed',fetch:rpcFetch,disableRetryOnRateLimit:true});
 connection.pumpcardsFetch=rpcFetch;
 return connection;
}
