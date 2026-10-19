# Production security review — 19 October 2026

This is a source review with local regression tests, not an independent audit or a funded mainnet certification.

## Fixes completed

- Finalized transactions are required before accounting or advancing purchase jobs. Merely confirmed transactions remain pending; their signed bytes are never rebuilt.
- Jupiter transactions are decoded against the pinned official `jup-ag/jupiter-cpi` IDL. Only the supported shared-account ExactOut route is accepted, with exact USDC output, bounded SOL input, configured slippage, zero platform fee and the treasury's destination account. Canonical re-encoding rejects trailing data. Unknown/new route variants fail closed.
- External instructions are restricted to the expected transfer, memo, associated-account, wrap/unwrap and compute operations. Wrapped SOL funding and priority fees are bounded. Purchase payer, USDC payment destination, exact price and exact memo are checked.
- Simulation checks reserve and asset balance changes before signing/broadcast. Purchase fees now reduce the creator-fee ledger, and selection budgets for both swap and purchase costs.
- Delivery is bound to the recorded purchase signature. A finalized successful delivery must show the NFT mint with amount one owned by the committed winner before publishing the result.
- Provider rate limits/timeouts can retry the recorded operation. Interrupted pack generation and uncertain transaction outcomes still halt for reconciliation without drawing another winner or creating another payment.
- Live startup fails on incomplete/invalid configuration. Monetary settings use bounded decimal inputs, RPC must use HTTPS, and the public health endpoint reports paused workers as unready.
- Public endpoints are read-only and have restrictive browser headers and HTTP timeouts. Secrets and signed transaction journals stay server-side and are excluded from Git.
- Dependency fixes remove the vulnerable streaming parser through Jayson 5.0.0. No known advisories remain in the checked lockfile. Native bigint conversion uses the bounded local implementation.
- Added `npm run preflight`: validates launch prerequisites without signing or sending. It must run with the worker stopped, using the same persistent data directory.

## Evidence

26 local tests cover weighted integer selection, round selection/carryover, malicious route substitutions, amount bounds, trailing instruction data, finality, transaction reuse, purchase identity, configuration rejection, RPC package compatibility and mocked purchase-to-delivery flow. Syntax checks pass. The missing-environment preflight exits unsuccessfully and lists missing variable names without revealing values.

## Operational requirements and unverified boundaries

The token and credentials have not been supplied, so creator-fee collection, authenticated route construction, real pack purchase and holder delivery have not been tested end to end. Start with a $25 maximum pack and $25 daily budget, observe one finalized delivery, then raise limits deliberately.

Use one worker, persistent SQLite storage, a dedicated creator wallet and a trusted mainnet RPC providing complete token-account snapshots. The operator controls the server and random draw; this is not an on-chain VRF or trustless treasury. Do not use the creator wallet for unrelated spending or other token launches. Simulations cannot protect against concurrent external use of the same wallet.

Uncertain/expired/failed payments, interrupted generation, refunds, unsupported provider instructions, and stale locks after a crash require operator reconciliation as documented in README.md. Do not clear journals, regenerate a payment or reroll a winner to recover. These cases deliberately stop automation. Provider schema changes can require an adapter update; the pinned Jupiter schema intentionally does not accept unknown routes. Compressed or nonstandard collectible deliveries without standard token-balance ownership evidence will also pause for review.

This supports direct creator SOL rewards, not fee sharing, cashback, native Pump holder rewards or non-SOL quote tokens. Hosting and the funded first-pack validation remain launch tasks.

## References

- Collector Crypt API: https://docs.collectorcrypt.com/gacha/api
- Jupiter instruction schema: https://github.com/jup-ag/jupiter-cpi/blob/main/idl.json
- Jupiter swap API: https://developers.jup.ag/docs/api-reference/swap/v1/swap
- Pump creator fees: https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/COLLECT_CREATOR_FEE.md
