import {loadConfig} from './config.mjs';
import {LiveWorker} from './worker.mjs';
import {snapshotHolders} from './holders.mjs';
import {usdUnits,validateSwap} from './transactions.mjs';

// Never calls tick, execute, generatePack, openPack or broadcasts a transaction.
try {
 const config=loadConfig({...process.env,LIVE_ENABLED:'true'});
 if(config.missing.length)throw Error('Missing: '+config.missing.join(', '));
 const worker=new LiveWorker(config);
 await worker.init();
 if(worker.state.halted||worker.state.job||worker.state.pendingFee)throw Error('Existing job requires reconciliation before launch preflight');
 const balance=await worker.connection.getBalance(worker.signer.publicKey,'finalized');
 if(balance/1e9<config.reserveSol+.01)throw Error('Fund the treasury transaction reserve plus 0.01 SOL');
 const snapshot=await snapshotHolders(worker.connection,config.mint,[worker.signer.publicKey.toBase58(),...config.excluded],BigInt(config.minimum));
 if(!snapshot.holders.length)throw Error('No eligible holders');
 const packs=(await worker.cc.machines()).filter(p=>p.available&&p.price<=config.maxPackUsd&&p.price<=config.dailyUsd).sort((a,b)=>a.price-b.price);
 if(!packs.length)throw Error('No pack available within configured limits');
 const q=await worker.jupiter.quote(usdUnits(packs[0].price),config.slippage);
 const maxInput=BigInt(q.otherAmountThreshold);
 if(maxInput+10000000n>BigInt(Math.floor(config.maxSwapSol*1e9)))throw Error('MAX_SWAP_SOL cannot fund the smallest available pack plus transaction buffer');
 if(BigInt(balance)>maxInput+BigInt(Math.ceil(config.reserveSol*1e9))){
 const {message}=await worker.transactions.decode(await worker.jupiter.build(q,worker.signer.publicKey.toBase58()));
 validateSwap(message,{payer:worker.signer.publicKey.toBase58(),cost:usdUnits(packs[0].price),maxInput,slippage:config.slippage});
 }else console.log('Unsigned swap build deferred until sufficient creator fees are collected.');
 console.log('PASS: mainnet, creator authority, API access, holder snapshot, spending settings and quote access. No transactions signed or sent. A funded first pack is still required to verify delivery.');
} catch(error) {
 // Provider errors may contain credential-bearing RPC URLs; never print them.
 console.error('Preflight failed. Check required environment settings, reserve, API access and supported direct-creator configuration.');
 if(error.message.startsWith('Missing:'))console.error(error.message);
 process.exitCode=1;
}
