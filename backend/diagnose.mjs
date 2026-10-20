import {DatabaseSync} from 'node:sqlite';
import {resolve} from 'node:path';
import {operatorStatus} from './diagnostics.mjs';
// Read-only: does not initialize a worker, load a signer, call providers or sign.
try{
 const db=new DatabaseSync(resolve(process.env.DATA_DIR||process.env.RAILWAY_VOLUME_MOUNT_PATH||'./data','pumpdrop.sqlite'),{readOnly:true});
 const state=JSON.parse(db.prepare("SELECT value FROM state WHERE id='worker'").get()?.value||'{}');
 const store={tx:id=>{const row=db.prepare('SELECT value FROM txs WHERE id=?').get(id);return row?JSON.parse(row.value):null}};
 console.log(JSON.stringify(operatorStatus(state,store),null,2));db.close();
}catch{console.error('Unable to read the worker database. Run this in the Railway service with its persistent volume attached.');process.exitCode=1}
