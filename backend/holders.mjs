import {PublicKey} from '@solana/web3.js';
import {TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID} from '@solana/spl-token';
import {randomBytes,createHash} from 'node:crypto';
export function aggregateHolders(accounts,{mint,excluded=[],minimum=1n}={}){
 const deny=new Set(excluded),balances=new Map();
 for(const a of accounts){const info=a.account?.data?.parsed?.info;if(!info||info.mint!==mint)throw Error('Invalid holder account data');if(info.state!=='initialized')continue;const owner=info.owner;if(deny.has(owner)||!PublicKey.isOnCurve(new PublicKey(owner).toBytes()))continue;const raw=info.tokenAmount?.amount;if(!/^\d+$/.test(raw))throw Error('Invalid token amount');balances.set(owner,(balances.get(owner)||0n)+BigInt(raw))}
 return [...balances].filter(([,b])=>b>=minimum&&b>0n).sort(([a],[b])=>a.localeCompare(b)).map(([wallet,amount])=>({wallet,amount:amount.toString()}));
}
export function weightedPick(holders,bytes=randomBytes){
 const total=holders.reduce((s,h)=>s+BigInt(h.amount),0n);if(total<=0n)throw Error('No eligible holders');
 const n=Math.ceil(total.toString(2).length/8),space=1n<<BigInt(n*8),limit=space-space%total;let draw;
 do{draw=BigInt('0x'+bytes(n).toString('hex'))}while(draw>=limit);
 const ticket=draw%total;let cumulative=0n;
 for(const h of holders){cumulative+=BigInt(h.amount);if(ticket<cumulative)return {wallet:h.wallet,ticket:ticket.toString(),total:total.toString()}}
 throw Error('Invalid weighted draw');
}
export async function snapshotHolders(connection,mint,excluded,minimum){
 const mintKey=new PublicKey(mint),mintInfo=await connection.getAccountInfo(mintKey,'finalized');
 if(!mintInfo||![TOKEN_PROGRAM_ID.toBase58(),TOKEN_2022_PROGRAM_ID.toBase58()].includes(mintInfo.owner.toBase58()))throw Error('Token mint not found');
 // web3.js's parsed helper does not decode withContext; use the documented JSON-RPC response directly.
 const response=await (connection.pumpcardsFetch||fetch)(connection.rpcEndpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getProgramAccounts',params:[mintInfo.owner.toBase58(),{encoding:'jsonParsed',commitment:'finalized',withContext:true,filters:[{memcmp:{offset:0,bytes:mint}}]}]}),signal:AbortSignal.timeout(60000)});
 if(!response.ok)throw Error('Holder snapshot RPC failed');const body=await response.json();if(body.error)throw Object.assign(Error('RPC rejected full holder snapshot'),{code:body.error.code});const result=body.result;
 if(!Array.isArray(result.value)||!Number.isInteger(result.context?.slot))throw Error('RPC must return a complete contextual holder snapshot');
 const holders=aggregateHolders(result.value,{mint,excluded,minimum});
 return {slot:result.context.slot,holders,hash:createHash('sha256').update(JSON.stringify(holders)).digest('hex'),createdAt:Date.now()};
}
