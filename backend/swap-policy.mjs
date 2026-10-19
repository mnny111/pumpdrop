import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {BorshInstructionCoder} from '@coral-xyz/anchor';
import {NATIVE_MINT,getAssociatedTokenAddressSync} from '@solana/spl-token';
import {PublicKey} from '@solana/web3.js';

// Pinned official jup-ag/jupiter-cpi schema. Convert legacy defined-type syntax
// to Anchor 0.31 syntax; canonical re-encoding rejects trailing/ambiguous data.
const legacy=JSON.parse(readFileSync(new URL('./jupiter-idl.json',import.meta.url)));
const convert=x=>Array.isArray(x)?x.map(convert):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,k==='defined'&&typeof v==='string'?{name:v}:convert(v)])):x;
const idl=convert(legacy);
for(const ix of idl.instructions)ix.discriminator=[...createHash('sha256').update('global:'+ix.name.replace(/[A-Z]/g,c=>'_'+c.toLowerCase())).digest().subarray(0,8)];
export const routeCoder=new BorshInstructionCoder(idl);
export function validateRoute(ix,{payer,outputMint,cost,maxInput,slippage}){
 const data=Buffer.from(ix.data),decoded=routeCoder.decode(data);
 if(!decoded||decoded.name!=='sharedAccountsExactOutRoute'||!routeCoder.encode(decoded.name,decoded.data).equals(data))throw Error('Unsupported or malformed Jupiter route');
 const d=decoded.data,quoted=BigInt(d.quotedInAmount.toString()),maximum=(quoted*BigInt(10000+d.slippageBps)+9999n)/10000n;
 if(BigInt(d.outAmount.toString())!==BigInt(cost)||d.slippageBps!==slippage||d.platformFeeBps!==0||maximum>BigInt(maxInput)||quoted<=0n)throw Error('Jupiter route exceeds approved quote');
 const wallet=new PublicKey(payer),expected={2:wallet,3:getAssociatedTokenAddressSync(NATIVE_MINT,wallet),6:getAssociatedTokenAddressSync(outputMint,wallet),7:NATIVE_MINT,8:outputMint};
 for(const [index,key] of Object.entries(expected))if(!ix.keys[index]?.pubkey.equals(key))throw Error('Jupiter route account mismatch');
 if(!ix.keys[2].isSigner)throw Error('Jupiter authority must sign');
}
