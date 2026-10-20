import test from 'node:test';
import assert from 'node:assert/strict';
import bs58 from 'bs58';
import {Keypair} from '@solana/web3.js';
import {loadConfig} from '../backend/config.mjs';
import {loadTreasury} from '../backend/wallet.mjs';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';

test('base58 private key loads the same wallet as a JSON keypair',()=>{
 const wallet=Keypair.generate();const c=loadConfig({TREASURY_PRIVATE_KEY:' '+bs58.encode(wallet.secretKey)+' '});
 assert.equal(loadTreasury(c).publicKey.toBase58(),wallet.publicKey.toBase58());
 assert.ok(!c.missing.some(v=>v.startsWith('TREASURY')));
});
test('base58 loader rejects public addresses, recovery phrases and corrupt keypairs',()=>{
 const corrupt=Keypair.generate().secretKey;corrupt[63]^=1;
 for(const privateKey of [Keypair.generate().publicKey.toBase58(),'word '.repeat(12),bs58.encode(corrupt),'0invalid-private-secret','1'.repeat(10000)]){
  assert.throws(()=>loadTreasury({privateKey}),e=>e.message==='Treasury must be a valid Solana base58 private key or 64-byte JSON keypair array');
 }
});
test('conflicting base58 and legacy wallet settings are rejected',()=>{
 for(const extra of [{TREASURY_KEYPAIR_JSON:'[]'},{TREASURY_KEYPAIR_PATH:'file'}])assert.throws(()=>loadConfig({TREASURY_PRIVATE_KEY:'secret',...extra}),/Set only/);
 assert.throws(()=>loadTreasury({privateKey:'secret',keyJson:'[]'}),/Set only/);
});

test('Railway wallet loads directly from JSON without a key file',()=>{
 const wallet=Keypair.generate(),c=loadConfig({TREASURY_KEYPAIR_JSON:JSON.stringify([...wallet.secretKey])});
 assert.equal(c.keyFile,'');assert.equal(loadTreasury(c).publicKey.toBase58(),wallet.publicKey.toBase58());
 assert.ok(!c.missing.some(v=>v.startsWith('TREASURY')));
});
test('wallet validation rejects invalid or conflicting secrets without echoing values',()=>{
 for(const keyJson of ['private-secret-not-json','[1,2]',JSON.stringify(Array(64).fill(999)),JSON.stringify(Array(64).fill(0))]){
  assert.throws(()=>loadTreasury({keyJson}),error=>error.message==='Treasury must be a valid Solana base58 private key or 64-byte JSON keypair array');
 }
 assert.throws(()=>loadConfig({TREASURY_KEYPAIR_JSON:'secret',TREASURY_KEYPAIR_PATH:'file'}),/Set only/);
});
test('Railway automatically selects its volume and blocks ephemeral live storage',()=>{
 assert.equal(loadConfig({RAILWAY_VOLUME_MOUNT_PATH:'/data'}).dataDir,'/data');
 assert.throws(()=>loadConfig({LIVE_ENABLED:'true',RAILWAY_ENVIRONMENT_ID:'test'}),/volume/);
 assert.throws(()=>loadConfig({LIVE_ENABLED:'true',RAILWAY_ENVIRONMENT_ID:'test',RAILWAY_VOLUME_MOUNT_PATH:'/data',DATA_DIR:'/outside'}),/inside/);
 assert.equal(loadConfig({LIVE_ENABLED:'true',RAILWAY_ENVIRONMENT_ID:'test',RAILWAY_VOLUME_MOUNT_PATH:'/data',DATA_DIR:'/data/db'}).dataDir,'/data/db');
});
test('default server starts in preview mode and never exposes the base58 private key',async()=>{
 const listener=createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');const port=listener.address().port;await new Promise(r=>listener.close(r));
 const keyJson=bs58.encode(Keypair.generate().secretKey);
 const env={...process.env,PORT:String(port),LIVE_ENABLED:'false',TREASURY_KEYPAIR_JSON:'',TREASURY_PRIVATE_KEY:keyJson,TREASURY_KEYPAIR_PATH:'',MAIN_TOKEN_MINT:'',SOLANA_RPC_URL:'',MAX_PACK_USD:'',DAILY_PACK_BUDGET_USD:'',MAX_SWAP_SOL:''};
 // Stub only outgoing provider fetch in the child; exercise real HTTP routes.
 const child=spawn(process.execPath,['--import','data:text/javascript,globalThis.fetch=async()=>{throw new Error("offline test")}', 'server.mjs'],{cwd:new URL('..',import.meta.url),env,stdio:['ignore','pipe','pipe']});
 let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
 try{
  await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Startup timed out')),10000);child.stdout.on('data',()=>{if(output.includes('PumpCards:')){clearTimeout(timeout);resolve()}});child.once('exit',()=>{clearTimeout(timeout);reject(Error('Server exited before listening'))});});
  const health=await fetch(`http://127.0.0.1:${port}/api/health`);assert.equal(health.status,200);assert.equal((await health.json()).enabled,false);
  const state=await (await fetch(`http://127.0.0.1:${port}/api/state`)).text();assert.ok(!state.includes(keyJson));assert.ok(!output.includes(keyJson));
  assert.equal((await fetch(`http://127.0.0.1:${port}/.env`)).status,404);
 }finally{const stopped=once(child,'exit');child.kill();await stopped;}
});
