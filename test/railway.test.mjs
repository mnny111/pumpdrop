import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair} from '@solana/web3.js';
import {loadConfig} from '../backend/config.mjs';
import {loadTreasury} from '../backend/wallet.mjs';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';

test('Railway wallet loads directly from JSON without a key file',()=>{
 const wallet=Keypair.generate(),c=loadConfig({TREASURY_KEYPAIR_JSON:JSON.stringify([...wallet.secretKey])});
 assert.equal(c.keyFile,'');assert.equal(loadTreasury(c).publicKey.toBase58(),wallet.publicKey.toBase58());
 assert.ok(!c.missing.some(v=>v.startsWith('TREASURY')));
});
test('wallet validation rejects invalid or conflicting secrets without echoing values',()=>{
 for(const keyJson of ['private-secret-not-json','[1,2]',JSON.stringify(Array(64).fill(999)),JSON.stringify(Array(64).fill(0))]){
  assert.throws(()=>loadTreasury({keyJson}),error=>error.message==='Treasury must be a valid Solana 64-byte JSON keypair array');
 }
 assert.throws(()=>loadConfig({TREASURY_KEYPAIR_JSON:'secret',TREASURY_KEYPAIR_PATH:'file'}),/Set only/);
});
test('Railway automatically selects its volume and blocks ephemeral live storage',()=>{
 assert.equal(loadConfig({RAILWAY_VOLUME_MOUNT_PATH:'/data'}).dataDir,'/data');
 assert.throws(()=>loadConfig({LIVE_ENABLED:'true',RAILWAY_ENVIRONMENT_ID:'test'}),/volume/);
 assert.throws(()=>loadConfig({LIVE_ENABLED:'true',RAILWAY_ENVIRONMENT_ID:'test',RAILWAY_VOLUME_MOUNT_PATH:'/data',DATA_DIR:'/outside'}),/inside/);
 assert.equal(loadConfig({LIVE_ENABLED:'true',RAILWAY_ENVIRONMENT_ID:'test',RAILWAY_VOLUME_MOUNT_PATH:'/data',DATA_DIR:'/data/db'}).dataDir,'/data/db');
});
test('default server starts in preview mode and never exposes wallet JSON',async()=>{
 const listener=createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');const port=listener.address().port;await new Promise(r=>listener.close(r));
 const keyJson=JSON.stringify([...Keypair.generate().secretKey]);
 const env={...process.env,PORT:String(port),LIVE_ENABLED:'false',TREASURY_KEYPAIR_JSON:keyJson,TREASURY_KEYPAIR_PATH:'',MAIN_TOKEN_MINT:'',SOLANA_RPC_URL:'',MAX_PACK_USD:'',DAILY_PACK_BUDGET_USD:'',MAX_SWAP_SOL:''};
 // Stub only outgoing provider fetch in the child; exercise real HTTP routes.
 const child=spawn(process.execPath,['--import','data:text/javascript,globalThis.fetch=async()=>{throw new Error("offline test")}', 'server.mjs'],{cwd:new URL('..',import.meta.url),env,stdio:['ignore','pipe','pipe']});
 let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
 try{
  await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Startup timed out')),10000);child.stdout.on('data',()=>{if(output.includes('PumpDrop:')){clearTimeout(timeout);resolve()}});child.once('exit',()=>{clearTimeout(timeout);reject(Error('Server exited before listening'))});});
  const health=await fetch(`http://127.0.0.1:${port}/api/health`);assert.equal(health.status,200);assert.equal((await health.json()).enabled,false);
  const state=await (await fetch(`http://127.0.0.1:${port}/api/state`)).text();assert.ok(!state.includes(keyJson));assert.ok(!output.includes(keyJson));
  assert.equal((await fetch(`http://127.0.0.1:${port}/.env`)).status,404);
 }finally{const stopped=once(child,'exit');child.kill();await stopped;}
});
