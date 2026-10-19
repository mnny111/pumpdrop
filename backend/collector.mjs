export const CC_ORIGIN='https://gacha.collectorcrypt.com';
export const PACK_CODES={legendary:'pokemon_250',celestial:'pokemon_5000',starter:'pokemon_25',emperor:'onepiece_1000',sports:'sports_500',watch:'ewatch_500'};
export async function requestJson(url,{key,body,fetchImpl=fetch}={}){
 const r=await fetchImpl(url,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(key?{'x-api-key':key}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!r.ok){const error=new Error(`Provider request failed (${r.status})`);error.retryable=r.status===429||r.status>=500;throw error;}
 return r.json();
}
export class CollectorClient{
 constructor({key='',fetchImpl=fetch}={}){this.key=key;this.fetchImpl=fetchImpl}
 call(path,body){return requestJson(CC_ORIGIN+path,{key:this.key,body,fetchImpl:this.fetchImpl})}
 async machines(){const [catalog,status]=await Promise.all([this.call('/api/machines'),this.call('/api/status')]);if(!Array.isArray(catalog.machines)||!Array.isArray(status.gachas))throw Error('Invalid Collector Crypt catalogue');return Object.entries(PACK_CODES).map(([id,code])=>{const m=catalog.machines.find(m=>m.code===code);if(!m)return {id,code,available:false};const active=status.gachas.find(g=>g.code===code);return {id,code,name:m.name,price:m.price,stock:m.stock,odds:m.odds,image:new URL(m.imageNobg||m.thumbnailUrl,CC_ORIGIN).href,available:status.machineStatus==='running'&&active?.isOpen===true,checkedAt:Date.now()}})}
 async validateKey(){if(!this.key)throw Error('COLLECTOR_CRYPT_API_KEY is required');await this.call('/api/v1/machines')}
 async generate({payer,winner,code}){if(!Object.values(PACK_CODES).includes(code))throw Error('Pack not in approved catalogue');const r=await this.call('/api/generatePack',{playerAddress:payer,altPlayerAddress:winner,packType:code,turbo:false});if(typeof r.memo!=='string'||typeof r.transaction!=='string')throw Error('Invalid generated pack');return r}
 status(memo){return this.call('/api/pack/status?'+new URLSearchParams({memo}))}
 open(memo){return this.call('/api/openPack',{memo})}
}
export function verifyDelivery(status,job){
 if(status.pack?.refunded||status.pack?.refund_transaction_signature)throw Error('Pack refunded; halt reconciliation');
 if(status.pack?.wallet!==job.payer||status.pack?.pack_type!==job.code||status.pack?.turbo_mode!==false)throw Error('Pack identity mismatch');
 if(job.purchaseSignature&&status.pack?.transaction_signature!==job.purchaseSignature)throw Error('Purchase signature mismatch');
 const s=status.send;if(!s||s.status!=='confirmed')return null;
 if(s.to_wallet!==job.winner||!s.nft_address||!s.transaction_signature)throw Error('Recipient or NFT transfer mismatch');
 return {mint:s.nft_address,signature:s.transaction_signature};
}
