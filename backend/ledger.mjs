import {resolve} from 'node:path';
import {PublicKey} from '@solana/web3.js';
export function ledgerPath({dataDir,ledgerMode='legacy',mint,treasury}){
 if(ledgerMode==='legacy')return resolve(dataDir,'pumpdrop.sqlite');
 if(ledgerMode!=='fresh')throw Error('Invalid ledger mode');
 // Public keys also keep every path component inside the persistent data root.
 const token=new PublicKey(mint).toBase58(),wallet=new PublicKey(treasury).toBase58();
 return resolve(dataDir,'tokens',token,wallet+'.sqlite');
}
