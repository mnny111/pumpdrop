import {usdUnits} from './transactions.mjs';
export const ROUND_MS=60000;
export const nextRoundAt=(now=Date.now())=>(Math.floor(now/ROUND_MS)+1)*ROUND_MS;
// Compare integer USDC units. At an equal price, prefer the pack least recently opened.
export function rankedPacks(catalog,{maxPackUsd,dailyRemaining,history=[]}){
 const max=usdUnits(maxPackUsd),last=new Map();history.forEach((e,i)=>last.set(e.packId,i));
 return catalog.filter(p=>p.available&&usdUnits(p.price)<=max&&usdUnits(p.price)<=dailyRemaining)
 .sort((a,b)=>{const x=usdUnits(a.price),y=usdUnits(b.price);return x===y?(last.get(a.id)??-1)-(last.get(b.id)??-1):x>y?-1:1});
}
export function pickForUsd(catalog,budget,options){return rankedPacks(catalog,options).find(p=>usdUnits(p.price)<=budget)||null}
