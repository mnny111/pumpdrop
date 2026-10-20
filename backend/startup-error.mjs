// Only fixed, local messages are safe to log. RPC errors may contain secret URLs.
const known=new Set([
 'Treasury must be a valid Solana base58 private key or 64-byte JSON keypair array',
 'Set only one treasury key source',
 'Database belongs to a different token or treasury',
 'Mainnet RPC required',
 'Token routes fees to cashback/holder rewards, not the creator treasury',
 'Fee-sharing token detected; this worker requires a direct creator treasury',
 'Treasury signer is not the token creator',
 'This worker requires a SOL-quoted Pump.fun token',
 'PumpSwap creator differs from treasury',
 'Treasury signer is not the token creator or a configured fee sharing recipient',
 'Treasury wallet is not a recipient in the token fee sharing config',
 'Fee sharing config missing or invalid',
 'Fee sharing config mint mismatch',
 'Invalid fee sharing allocation'
]);
const hints={
 storage:'Check the persistent volume and its write permissions.',
 lock:'Another worker or a stale worker.lock exists. Stop all workers before reconciling the lock; retain the database.',
 wallet:'Check TREASURY_PRIVATE_KEY format and use only one wallet setting.',
 identity:'The persistent database must match this token and treasury.',
 rpc:'Check SOLANA_RPC_URL credentials, connectivity and mainnet access.',
 collector:'Remove a blank/invalid optional Collector key or supply a valid one.',
 pump:'Check the token mint, creator wallet, supported fee configuration and RPC access to Pump accounts.'
};
export function startupError(error,stage){
 const label=Object.hasOwn(hints,stage)?stage:'initialization';
 const detail=known.has(error?.message)?error.message:(hints[label]||'Check startup configuration.');
 return `Startup validation failed [${label}]: ${detail}`;
}
