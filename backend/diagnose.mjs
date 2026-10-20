import {DatabaseSync} from 'node:sqlite';
import {resolve} from 'node:path';
import {readFileSync} from 'node:fs';
import {ledgerPath} from './ledger.mjs';
import {operatorStatus} from './diagnostics.mjs';
// Read-only: does not initialize a worker, load a signer, call providers or sign.
try{
 const dataDir=process.env.DATA_DIR||process.env.RAILWAY_VOLUME_MOUNT_PATH||'./data';
 let options={dataDir,ledgerMode:'legacy'};
 if(process.env.TOKEN_LEDGER_MODE==='fresh'){
  const active=JSON.parse(readFileSync(resolve(dataDir,'active-ledger.json'),'utf8'));
  if(active.ledgerMode!=='fresh'||active.mint!==(process.env.MAIN_TOKEN_MINT||'').trim())throw Error('Configured token has not started');
  options={...active,dataDir};
 }
 const db=new DatabaseSync(ledgerPath(options),{readOnly:true});
 const state=JSON.parse(db.prepare("SELECT value FROM state WHERE id='worker'").get()?.value||'{}');
 const store={tx:id=>{const row=db.prepare('SELECT value FROM txs WHERE id=?').get(id);return row?JSON.parse(row.value):null}};
 console.log(JSON.stringify(operatorStatus(state,store),null,2));db.close();
}catch{console.error('Unable to read the worker database. Run this in the Railway service with its persistent volume attached.');process.exitCode=1}
