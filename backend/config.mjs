import {resolve,relative,isAbsolute} from 'node:path';
import {PublicKey} from '@solana/web3.js';
export function loadConfig(env=process.env){
 const c={enabled:env.LIVE_ENABLED==='true',mint:(env.MAIN_TOKEN_MINT||'').trim(),rpc:env.SOLANA_RPC_URL||'',keyFile:env.TREASURY_KEYPAIR_PATH||'',keyJson:(env.TREASURY_KEYPAIR_JSON||'').trim(),privateKey:(env.TREASURY_PRIVATE_KEY||'').trim(),ccKey:(env.COLLECTOR_CRYPT_API_KEY||'').trim(),jupKey:env.JUPITER_API_KEY||'',packId:env.AUTO_PACK_ID||'starter',excluded:(env.EXCLUDED_HOLDERS||'').split(',').map(x=>x.trim()).filter(Boolean),dataDir:env.DATA_DIR||env.RAILWAY_VOLUME_MOUNT_PATH||'./data',maxPackUsd:Number(env.MAX_PACK_USD||0),dailyUsd:Number(env.DAILY_PACK_BUDGET_USD||0),reserveSol:Number(env.MIN_SOL_RESERVE||0.02),maxSwapSol:Number(env.MAX_SWAP_SOL||0),slippage:Number(env.SLIPPAGE_BPS||50),minimum:env.MIN_HOLDER_RAW||'1',dedicated:env.DEDICATED_CREATOR_CONFIRMED==='true'};
 if(env.LIVE_ENABLED&&!['true','false'].includes(env.LIVE_ENABLED))throw Error('LIVE_ENABLED must be true or false');
 if(c.rpc&&new URL(c.rpc).protocol!=='https:')throw Error('SOLANA_RPC_URL must use HTTPS');
 for(const name of ['MAX_PACK_USD','DAILY_PACK_BUDGET_USD','MAX_SWAP_SOL','MIN_SOL_RESERVE'])if(env[name]&&(!/^\d+(\.\d{1,6})?$/.test(env[name])||Number(env[name])>1000000))throw Error(name+' must be a decimal up to 1000000 with at most six decimals');
 if([c.privateKey,c.keyJson,c.keyFile].filter(Boolean).length>1)throw Error('Set only one of TREASURY_PRIVATE_KEY, TREASURY_KEYPAIR_JSON or TREASURY_KEYPAIR_PATH');
 if(c.enabled&&env.RAILWAY_ENVIRONMENT_ID){
  if(!env.RAILWAY_VOLUME_MOUNT_PATH)throw Error('Attach a Railway volume before enabling live purchases');
  const within=relative(resolve(env.RAILWAY_VOLUME_MOUNT_PATH),resolve(c.dataDir));
  if(within==='..'||within.startsWith('..'+(process.platform==='win32'?'\\':'/'))||isAbsolute(within))throw Error('DATA_DIR must be inside the Railway volume');
 }
 const missing=[];for(const [key,value] of [['MAIN_TOKEN_MINT',c.mint],['SOLANA_RPC_URL',c.rpc],['TREASURY_PRIVATE_KEY (or JSON/file alternative)',c.privateKey||c.keyJson||c.keyFile],['JUPITER_API_KEY',c.jupKey]])if(!value)missing.push(key);
 if(c.mint){try{new PublicKey(c.mint)}catch{throw Error('MAIN_TOKEN_MINT must be a public Solana mint address, not a URL or placeholder')}}for(const x of c.excluded){try{new PublicKey(x)}catch{throw Error('EXCLUDED_HOLDERS must contain comma-separated public Solana wallet addresses')}}
 if(!Number.isFinite(c.maxPackUsd)||c.maxPackUsd<=0)missing.push('MAX_PACK_USD');if(!Number.isFinite(c.dailyUsd)||c.dailyUsd<=0)missing.push('DAILY_PACK_BUDGET_USD');if(!Number.isFinite(c.maxSwapSol)||c.maxSwapSol<=0)missing.push('MAX_SWAP_SOL');if(!c.dedicated)missing.push('DEDICATED_CREATOR_CONFIRMED');
 if(!Number.isInteger(c.slippage)||c.slippage<1||c.slippage>100)throw Error('SLIPPAGE_BPS must be 1–100');if(!Number.isFinite(c.reserveSol)||c.reserveSol<0.01)throw Error('MIN_SOL_RESERVE must be at least 0.01');if(!/^\d+$/.test(c.minimum)||BigInt(c.minimum)<1n)throw Error('MIN_HOLDER_RAW must be a positive integer');
 return {...c,missing};
}
