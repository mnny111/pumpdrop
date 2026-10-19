import test from 'node:test';
import assert from 'node:assert/strict';
import {requireMainnet} from '../backend/network.mjs';
test('accepts the full genesis hash returned by Solana mainnet RPC',async()=>{
 await requireMainnet({getGenesisHash:async()=>'5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'});
});
test('rejects other networks and the former truncated identifier',async()=>{
 for(const hash of ['5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp','EtWTRABZaYq6iMfeYKouRu166VU2xqa1','4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY','',null]){
  await assert.rejects(requireMainnet({getGenesisHash:async()=>hash}),/Mainnet RPC required/);
 }
});
