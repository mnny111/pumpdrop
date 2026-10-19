import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
export class Store{
 constructor(path){mkdirSync(dirname(path),{recursive:true});this.db=new DatabaseSync(path);this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS state (id TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS txs (id TEXT PRIMARY KEY, value TEXT NOT NULL)')}
 get(id,fallback=null){const r=this.db.prepare('SELECT value FROM state WHERE id=?').get(id);return r?JSON.parse(r.value):fallback}
 set(id,value){this.db.prepare('INSERT INTO state VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(id,JSON.stringify(value));return value}
 tx(id){const r=this.db.prepare('SELECT value FROM txs WHERE id=?').get(id);return r?JSON.parse(r.value):null}
 putTx(id,value){this.db.prepare('INSERT INTO txs VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(id,JSON.stringify(value));return value}
 close(){this.db.close()}
}
