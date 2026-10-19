// Full getGenesisHash response, verified against api.mainnet-beta.solana.com.
export const MAINNET_GENESIS_HASH='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
export async function requireMainnet(connection){
 if(await connection.getGenesisHash()!==MAINNET_GENESIS_HASH)throw Error('Mainnet RPC required');
}
