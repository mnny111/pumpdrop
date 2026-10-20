import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
export class Store{
 constructor(path){mkdirSync(dirname(path),{recursive:true});this.db=new DatabaseSync(path);this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS state (id TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS txs (id TEXT PRIMARY KEY, value TEXT NOT NULL)')}
 get(id,fallback=null){const r=this.db.prepare('SELECT value FROM state WHERE id=?').get(id);return r?JSON.parse(r.value):fallback}
 set(id,value){this.db.prepare('INSERT INTO state VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(id,JSON.stringify(value));return value}
 tx(id){const r=this.db.prepare('SELECT value FROM txs WHERE id=?').get(id);return r?JSON.parse(r.value):null}
 putTx(id,value){this.db.prepare('INSERT INTO txs VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(id,JSON.stringify(value));return value}
 assertIdentity(identity){
  const saved=this.get('identity');if(!saved||saved.mint===identity.mint&&saved.treasury===identity.treasury)return;
  const worker=this.get('worker',{});
  const txs=this.db.prepare('SELECT COUNT(*) AS n FROM txs').get().n;
  const extra=this.db.prepare("SELECT COUNT(*) AS n FROM state WHERE id NOT IN ('worker','identity')").get().n;
  const empty=!txs&&!extra&&!worker.job&&!worker.pendingFee&&!worker.halted&&!worker.event&&!(worker.history||[]).length&&BigInt(worker.feeBudget||'0')===0n&&Object.values(worker.daily||{}).every(v=>BigInt(v)===0n);
  if(!empty)throw Error('Database belongs to a different token or treasury');
  // A failed initial setup may bind identity before any financial activity.
  // Caller commits the new identity only after all startup checks pass.
 }
 close(){this.db.close()}
}
