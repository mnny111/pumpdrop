import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair} from '@solana/web3.js';
import {CollectorClient} from '../backend/collector.mjs';
import {loadConfig} from '../backend/config.mjs';

test('complete live configuration does not require a Collector key',()=>{
 const c=loadConfig({LIVE_ENABLED:'true',MAIN_TOKEN_MINT:Keypair.generate().publicKey.toBase58(),SOLANA_RPC_URL:'https://example.com',TREASURY_KEYPAIR_JSON:'[]',JUPITER_API_KEY:'test',MAX_PACK_USD:'25',DAILY_PACK_BUDGET_USD:'25',MAX_SWAP_SOL:'1',DEDICATED_CREATOR_CONFIRMED:'true',COLLECTOR_CRYPT_API_KEY:'  '});
 assert.deepEqual(c.missing,[]);assert.equal(c.ccKey,'');
});
test('keyless startup skips partner endpoint and play requests omit authentication',async()=>{
 const calls=[];const cc=new CollectorClient({fetchImpl:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({memo:'cc-test',transaction:'AQ=='})}}});
 await cc.validateKey();assert.equal(calls.length,0);
 await cc.generate({payer:'payer',winner:'winner',code:'pokemon_25'});await cc.status('cc-test');await cc.open('cc-test');
 assert.equal(calls.length,3);assert.ok(calls.every(c=>!('x-api-key' in c.options.headers)&&!c.url.includes('/api/v1/')));
 assert.deepEqual(JSON.parse(calls[0].options.body),{playerAddress:'payer',altPlayerAddress:'winner',packType:'pokemon_25',turbo:false});
});
test('supplied Collector key is validated and sent with play requests',async()=>{
 const calls=[];const cc=new CollectorClient({key:' test-key ',fetchImpl:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({})}}});
 await cc.validateKey();await cc.status('cc-test');assert.ok(calls[0].url.endsWith('/api/v1/machines'));assert.ok(calls.every(c=>c.options.headers['x-api-key']==='test-key'));
});
test('invalid supplied key fails without unauthenticated fallback',async()=>{
 let calls=0;const cc=new CollectorClient({key:'invalid',fetchImpl:async()=>{calls++;return {ok:false,status:401}}});
 await assert.rejects(cc.validateKey(),/401/);assert.equal(calls,1);assert.equal(cc.key,'invalid');
});
