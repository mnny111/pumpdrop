import {readFileSync} from 'node:fs';
import {Keypair} from '@solana/web3.js';

export function loadTreasury(config){
 if(config.keyJson&&config.keyFile)throw Error('Set only TREASURY_KEYPAIR_JSON or TREASURY_KEYPAIR_PATH');
 try {
  const raw=JSON.parse(config.keyJson||readFileSync(config.keyFile,'utf8'));
  if(!Array.isArray(raw)||raw.length!==64||raw.some(x=>!Number.isInteger(x)||x<0||x>255))throw Error();
  return Keypair.fromSecretKey(Uint8Array.from(raw));
 }catch{throw Error('Treasury must be a valid Solana 64-byte JSON keypair array');}
}
