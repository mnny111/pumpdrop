# PumpDrop

A Solana / Pump.fun creator-fee-funded Collector Crypt pack opener. One shared page, one 60-second round, one token-balance-weighted recipient per real pack.

## What is implemented

- Live Collector Crypt catalogue, official pack art, prices and machine availability.
- All six requested packs: Starter $25, Legendary $250, Sports $500, Watch $500, Emperor $1,000, Celestial $5,000. These are provider prices at the time checked; the worker refreshes prices before spending.
- Shared server-clock 60-second timer. Each round selects the highest affordable available pack subject to configured limits. $30 selects $25 and retains the remainder; $500 selects $500; $1,000 selects Emperor. Sports/Watch alternate at the same price. At most one purchase pipeline runs at a time. Slow blockchain settlement delays a round; it never creates catch-up purchase bursts.
- Uses actual SOL→USDC quotes, including input slippage and a transaction-cost buffer, rather than a guessed SOL/USD rate. Remaining SOL stays in the creator-fee ledger for later rounds.
- Direct-creator SOL fee collection for the Pump curve and graduated PumpSwap pool, including newer fee sweep instructions.
- Creator-fee accounting records finalized treasury balance deltas, including swap and purchase costs. Existing deposits are not automatically counted as pack funding. Use a small separate SOL deposit for transaction reserve.
- Complete finalized token-account snapshot; multiple token accounts are combined by owner. A CSPRNG draw uses raw integer token balances, with rejection sampling to avoid modulo bias. Treasury, frozen accounts, off-curve owners and configured excluded wallets cannot win. Minimum balance is configurable. This is a server-generated weighted draw, not an externally verifiable VRF winner selection.
- Winner, snapshot hash, raw snapshot, ticket, purchase memo and signed transaction identities persist before payment. Collector Crypt receives the winner as `altPlayerAddress`; turbo buybacks are disabled, so the collectible goes to the holder.
- Shared animation begins after payment confirmation. The reveal uses Collector Crypt's actual result and is published only after the delivery signature finalizes and the provider's recipient matches the committed holder. Solscan delivery links accompany real results.
- SQLite/WAL journal and single-worker lock; confirmed transactions are never rebuilt. Uncertain, expired or failed financial operations pause for reconciliation instead of paying again or drawing another wallet.

## Launch setup

1. Use Node 24 LTS. Run `npm ci`, copy `.env.example` to `.env`, and run `npm start`.
2. After launching your token, set `MAIN_TOKEN_MINT` to its public mint address.
3. Use a **dedicated direct creator wallet** for this token and put its Solana JSON keypair file outside the repository. Set `TREASURY_KEYPAIR_PATH` to that file path. Never paste a seed/private key into chat or browser code. The worker verifies that this signer is the curve and pool creator.
4. Set a mainnet `SOLANA_RPC_URL` that supports full `getProgramAccounts` responses and transaction history. A top-holder-only API is not sufficient.
5. Obtain `COLLECTOR_CRYPT_API_KEY` through Collector Crypt's partner flow and `JUPITER_API_KEY` through Jupiter's developer portal. Keys remain server-side. The Collector key is validated against an authenticated endpoint before buying.
6. Set explicit `MAX_PACK_USD`, `DAILY_PACK_BUDGET_USD`, `MAX_SWAP_SOL`, `MIN_SOL_RESERVE`, `EXCLUDED_HOLDERS` and `MIN_HOLDER_RAW`. The daily limit resets at UTC midnight and reserves a pack's cost before purchase. Failed/uncertain jobs do not free the reserved budget automatically.
7. Set `DEDICATED_CREATOR_CONFIRMED=true` only if this creator wallet is dedicated to this token: Pump creator vaults can aggregate rewards from other coins created by the same wallet.
8. Stop any running worker and run `npm run preflight`. This checks configuration, authority, API access, eligible holders and quotes without signing or sending transactions. Then validate the flow with one small real pack before unattended operation. `LIVE_ENABLED=true` enables signing and real spending automatically. Defaults are disabled, with blank spending limits. A mint address alone does not enable trading.

Launch the token with ordinary direct creator fees assigned to the dedicated wallet. Tokens configured for cashback, native Pump holder rewards, fee-sharing recipients, or non-SOL quotes are explicitly rejected by this worker; they need a different fee adapter. No creator-authority changes are attempted.

Holder selection policy: balances at the finalized snapshot immediately before the purchase job. Transfers after the snapshot do not change that job's winner. Exchange custody owners are not distinguishable from normal wallets without the explicit exclusion list. The operator must set any team, exchange or burn exclusions before enabling.

## Hosting

Run `npm start` in a persistent Node service (for example Railway). Mount a persistent volume and set `DATA_DIR` to its path. Set exactly one replica. Use the environment's `PORT`. `/api/health` exposes only readiness, missing variable names, and catalogue status; there are no public mutation routes.

The old `.openai/hosting.json` is a static-preview manifest and cannot host this Node worker. Do not deploy the `dist` directory alone: it requires `/api/state`. No external publication has been completed. Previous Sites upload approval remains unresolved.

## Recovery

Back up the SQLite database and its WAL as a consistent snapshot. Never delete the database to resolve a failed transaction: it contains funding accounting and prevents duplicate purchases. Operator details are stored in `state.worker.halted` and transaction signatures in `txs`; signed transaction bytes are also private server data. After a failure, stop the process, reconcile the recorded signature and Collector memo, then update the affected job/accounting deliberately. There is intentionally no public 'retry purchase' button. A stale `worker.lock` after an unclean shutdown can be removed only after confirming the previous process is stopped; retain the SQLite data.

The worker halts on uncertain financial outcomes. Automated recovery for expired transactions requires operator reconciliation and is not a guaranteed hands-off recovery mechanism. Provider/API instruction changes may trigger the strict purchase/swap validation guard and need an adapter update.

## Verification and limits

26 local tests pass for exact weighted selection, holder aggregation, recipient checks, exact USDC payment, 60-second selection tiers, carryover, equal-price alternation, persistent transaction reuse, interrupted generation, reveal gating, and a mocked purchase-to-delivery flow. JavaScript syntax checks pass. The public mainnet Collector Crypt catalogue has been fetched successfully and the page displays real prices and artwork.

No token has launched, no treasury key or API credentials have been configured, and **no funded end-to-end collection, swap, pack purchase or NFT delivery has been executed**. Tests using mocks are not evidence of mainnet execution. Run a controlled first transaction after configuration before treating this as production-verified.

The dependency audit reports zero known vulnerabilities as of 19 October 2026. Jayson is pinned to 5.0.0, which removes the vulnerable streaming parser; RPC package loading is regression-tested. The native `bigint-buffer` path is replaced with a tested bounded pure-JavaScript codec. Installation scripts are disabled. See SECURITY-REVIEW.md for the review scope and remaining live-validation requirements.

## Official integration references

- https://docs.collectorcrypt.com/gacha/api
- https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/COLLECT_CREATOR_FEE.md
- https://developers.jup.ag/docs/api-reference/swap/v1/quote
- https://developers.jup.ag/docs/api-reference/swap/v1/swap

The current Jupiter integration uses the documented V1 ExactOut route for precise pack funding. Jupiter marks V1 as superseded by V2; a migration should be separately validated before changing the payment path.
