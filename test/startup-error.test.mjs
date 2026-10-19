import test from 'node:test';
import assert from 'node:assert/strict';
import {startupError} from '../backend/startup-error.mjs';
test('startup reports exact known creator mismatch',()=>{
 assert.match(startupError(Error('Treasury signer is not the token creator'),'pump'),/\[pump\]: Treasury signer is not the token creator/);
});
test('startup never echoes provider secrets or untrusted stage labels',()=>{
 const secret='https://rpc.example/?api-key=private-value';
 assert.ok(!startupError(Error(secret),'rpc').includes(secret));
 assert.ok(!startupError(Error(secret),secret).includes(secret));
 assert.match(startupError(Error(secret),'rpc'),/mainnet access/);
});
test('lock failures retain explicit safe recovery guidance',()=>{
 assert.match(startupError(Error('private path'),'lock'),/Stop all workers/);
});
