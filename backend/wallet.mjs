import {readFileSync} from 'node:fs';
import bs58 from 'bs58';
import {Keypair} from '@solana/web3.js';

export function loadTreasury(config){
 if([config.privateKey,config.keyJson,config.keyFile].filter(Boolean).length>1)throw Error('Set only one treasury key source');
 try {
  if(config.privateKey){
   const value=config.privateKey.trim();
   if(value.length<64||value.length>88||! /^[1-9A-HJ-NP-Za-km-z]+$/.test(value))throw Error();
   const bytes=bs58.decode(value);if(bytes.length!==64)throw Error();
   return Keypair.fromSecretKey(bytes);
  }
  const raw=JSON.parse(config.keyJson||readFileSync(config.keyFile,'utf8'));
  if(!Array.isArray(raw)||raw.length!==64||raw.some(x=>!Number.isInteger(x)||x<0||x>255))throw Error();
  return Keypair.fromSecretKey(Uint8Array.from(raw));
 }catch{throw Error('Treasury must be a valid Solana base58 private key or 64-byte JSON keypair array');}
}
