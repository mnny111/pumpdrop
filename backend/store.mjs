import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
export class Store{
 constructor(path){mkdirSync(dirname(path),{recursive:true});this.db=new DatabaseSync(path);this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS state (id TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS txs (id TEXT PRIMARY KEY, value TEXT NOT NULL)')}
 get(id,fallback=null){const r=this.db.prepare('SELECT value FROM state WHERE id=?').get(id);return r?JSON.parse(r.value):fallback}
 set(id,value){this.db.prepare('INSERT INTO state VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(id,JSON.stringify(value));return value}
 tx(id){const r=this.db.prepare('SELECT value FROM txs WHERE id=?').get(id);return r?JSON.parse(r.value):null}
 putTx(id,value){this.db.prepare('INSERT INTO txs VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(id,JSON.stringify(value));return value}
 assertIdentity(identity,{carryoverToMint}={}){
  const saved=this.get('identity');if(!saved||saved.mint===identity.mint&&saved.treasury===identity.treasury)return;
  const worker=this.get('worker',{});
  if(carryoverToMint===identity.mint&&saved.treasury===identity.treasury&&saved.mint!==identity.mint){
   if(worker.pendingFee)throw Error('Reconcile pending fee collection before token migration');
   const job=worker.job,purchase=job?this.tx(job.id+':purchase'):null;
   if(job&&(job.stage!=='open'||purchase?.status!=='confirmed'||!purchase.finalized||purchase.signature!==job.purchaseSignature))throw Error('Complete pending purchase before token migration');
   return {from:saved,to:identity,worker};
  }
  const txs=this.db.prepare('SELECT COUNT(*) AS n FROM txs').get().n;
  const extra=this.db.prepare("SELECT COUNT(*) AS n FROM state WHERE id NOT IN ('worker','identity')").get().n;
  const empty=!txs&&!extra&&!worker.job&&!worker.pendingFee&&!worker.halted&&!worker.event&&!(worker.history||[]).length&&BigInt(worker.feeBudget||'0')===0n&&Object.values(worker.daily||{}).every(v=>BigInt(v)===0n);
  if(!empty)throw Error('Database belongs to a different token or treasury');
  // A failed initial setup may bind identity before any financial activity.
  // Caller commits the new identity only after all startup checks pass.
 }
 commitIdentity(identity,options={}){
  this.db.exec('BEGIN IMMEDIATE');
  try{
   const migration=this.assertIdentity(identity,options);
   if(migration){
    const worker=structuredClone(migration.worker),at=Date.now();
    if(worker.job)worker.job.tokenMint??=migration.from.mint;
    for(const event of worker.history||[])event.tokenMint??=migration.from.mint;
    if(worker.event)worker.event.tokenMint??=migration.from.mint;
    // Carry the existing ledger and reservations, never the wallet's arbitrary deposits.
    this.set('migration:'+migration.from.mint+':'+identity.mint+':'+at,{
     at,from:migration.from,to:identity,feeBudget:worker.feeBudget,previousWorker:migration.worker
    });
    this.set('worker',worker);
   }
   this.set('identity',identity);this.db.exec('COMMIT');return Boolean(migration);
  }catch(error){this.db.exec('ROLLBACK');throw error}
 }
 close(){this.db.close()}
}
