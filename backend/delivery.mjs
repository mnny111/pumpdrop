import {PublicKey} from '@solana/web3.js';
import bs58 from 'bs58';
export const CORE_PROGRAM='CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d';
const address=k=>typeof k==='string'?k:k.toBase58();
// Read-only proof. The provider's asset/recipient/purchase association is checked
// separately; neither the provider's award JSON nor a log line proves ownership.
export async function verifyOnChainDelivery(connection,delivery,winner){
 const tx=await connection.getTransaction(delivery.signature,{commitment:'finalized',maxSupportedTransactionVersion:0});
 if(!tx)return false;
 if(!tx.meta||tx.meta.err)throw Error('NFT delivery transaction failed');
 const message=tx.transaction.message;
 const keys=[...(message.staticAccountKeys||message.accountKeys),...(tx.meta.loadedAddresses?.writable||[]),...(tx.meta.loadedAddresses?.readonly||[])].map(address);
 if(!keys.includes(winner))throw Error('Winner absent from confirmed delivery');
 if((tx.meta.postTokenBalances||[]).some(b=>b.mint===delivery.mint&&b.owner===winner&&b.uiTokenAmount?.amount==='1'))return true;
 // mpl-core TransferV1: discriminator 14, absent compression proof (0),
 // asset account 0, newOwner account 4. Only this uncompressed format is allowed.
 // Source: metaplex-foundation/mpl-core clients/js/src/generated/instructions/transferV1.ts
 const transfer=(message.compiledInstructions||message.instructions||[]).some(ix=>{
  if(keys[ix.programIdIndex]!==CORE_PROGRAM)return false;
  const accounts=ix.accountKeyIndexes||ix.accounts;
  let data;try{data=typeof ix.data==='string'?Buffer.from(bs58.decode(ix.data)):Buffer.from(ix.data)}catch{return false}
  return data.length===2&&data[0]===14&&data[1]===0&&accounts?.length>=5&&keys[accounts[0]]===delivery.mint&&keys[accounts[4]]===winner;
 });
 if(!transfer)throw Error('NFT ownership not verified in finalized delivery');
 if(!Number.isSafeInteger(tx.slot))throw Error('Core delivery slot missing');
 const info=await connection.getAccountInfo(new PublicKey(delivery.mint),{commitment:'finalized',minContextSlot:tx.slot});
 // AssetV1 uses key=1 at offset 0 and owner public key at offset 1.
 // Check program ownership first so unrelated accounts cannot impersonate Core.
 if(!info||address(info.owner)!==CORE_PROGRAM||info.data.length<33||info.data[0]!==1||!new PublicKey(info.data.subarray(1,33)).equals(new PublicKey(winner)))throw Error('Core asset ownership not verified');
 return true;
}
