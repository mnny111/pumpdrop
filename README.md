# PumpCards

A Solana / Pump.fun creator-fee-funded Collector Crypt pack opener. One shared page, one 60-second round, one token-balance-weighted recipient per real pack.

## Railway deployment

1. Create a Railway service from this GitHub repository on branch main. The committed Dockerfile pins Node 24 and railway.json configures the health check, one replica and restart policy. Leave custom build/start/pre-deploy commands empty. Remove any previous custom command that writes a keypair file.
2. Attach a persistent volume at /data. The app automatically uses RAILWAY_VOLUME_MOUNT_PATH; leave DATA_DIR unset. Live mode refuses to run on Railway without volume-backed storage.
3. Add the variables below using Railway's Raw Editor. Fill the empty required values after launch. Add TREASURY_PRIVATE_KEY separately as a private variable containing the dedicated creator wallet's exported base58 Solana private key (not its public address or recovery phrase). It is loaded directly in memory and never written to a wallet file. Leave TREASURY_KEYPAIR_JSON and TREASURY_KEYPAIR_PATH unset.
4. Deploy and Generate Domain in Railway networking. With LIVE_ENABLED=false the site runs without signing. Set LIVE_ENABLED=true only when ready for real purchases, initially capped at one $25 pack per UTC day. No custom start command is required.

```dotenv
LIVE_ENABLED=false
MAIN_TOKEN_MINT=
SOLANA_RPC_URL=
JUPITER_API_KEY=
MAX_PACK_USD=25
DAILY_PACK_BUDGET_USD=25
MAX_SWAP_SOL=1
MIN_SOL_RESERVE=0.02
SLIPPAGE_BPS=50
MIN_HOLDER_RAW=1
EXCLUDED_HOLDERS=
DEDICATED_CREATOR_CONFIRMED=false
```

The $25 limits above are optional first-test limits, not the permanent pack-selection policy. To allow all six pack tiers, set MAX_PACK_USD=5000 and choose DAILY_PACK_BUDGET_USD of at least 5000 (or higher if you want several expensive packs in one UTC day). Set MAX_SWAP_SOL high enough for your chosen pack tier at the current quote. The worker still purchases only the highest affordable available pack using collected creator fees and retains the remainder.

Set DEDICATED_CREATOR_CONFIRMED=true only for a creator wallet dedicated to this token. MAX_SWAP_SOL=1 is an example ceiling, not a target spend. Add excluded wallets as comma-separated addresses. Fund the wallet's transaction reserve separately. Railway supplies PORT automatically.

Optional read-only diagnostics: run npm run preflight through Railway SSH with live mode disabled. Do not use a pre-deploy command: Railway volumes are available only at runtime. The health check reports HTTP availability; the ready field separately reports automation readiness. Keep the service continuously running (do not enable serverless sleeping).

A persistent volume is a one-time Railway UI setup; railway.json does not create it. The actual Railway Docker build and first funded pack still require validation on Railway. Local startup tests do not establish mainnet execution.

Collector Crypt works without a partner key for these public packs. Without a key, purchases use standard cc- memos and do not receive partner attribution or private-machine access. PumpCards still tracks each purchase by its unique memo and verifies payment and recipient delivery.

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
3. Use a **dedicated treasury wallet** that is either the direct creator-fee wallet or a positive-share recipient in the token's on-chain Pump fee-sharing configuration and put its Solana JSON keypair file outside the repository. Set `TREASURY_KEYPAIR_PATH` to that file path, or use `TREASURY_PRIVATE_KEY` for an exported base58 private key (`TREASURY_KEYPAIR_JSON` remains available for JSON arrays). Set only one wallet source. Never paste a seed/private key into chat or browser code. The worker verifies direct creator authority or a positive share in the token's fee-sharing configuration.
4. Set a mainnet `SOLANA_RPC_URL` that supports full `getProgramAccounts` responses and transaction history. A top-holder-only API is not sufficient.
5. Obtain `JUPITER_API_KEY` through Jupiter's developer portal. `COLLECTOR_CRYPT_API_KEY` is optional: leave it unset or blank for standard public pack purchases. If supplied, it is validated against the authenticated partner endpoint; an invalid supplied key stops startup. Keys remain server-side.
6. Set explicit `MAX_PACK_USD`, `DAILY_PACK_BUDGET_USD`, `MAX_SWAP_SOL`, `MIN_SOL_RESERVE`, `EXCLUDED_HOLDERS` and `MIN_HOLDER_RAW`. The daily limit resets at UTC midnight and reserves a pack's cost before purchase. Failed/uncertain jobs do not free the reserved budget automatically.
7. Set `DEDICATED_CREATOR_CONFIRMED=true` only if this creator wallet is dedicated to this token: Pump creator vaults can aggregate rewards from other coins created by the same wallet.
8. Stop any running worker and run `npm run preflight`. This checks configuration, authority, API access, eligible holders and quotes without signing or sending transactions. Then validate the flow with one small real pack before unattended operation. `LIVE_ENABLED=true` enables signing and real spending automatically. Defaults are disabled, with blank spending limits. A mint address alone does not enable trading.

Direct creator fees and redirected SOL fees through Pump fee sharing are supported. The launch wallet can differ from the treasury: TREASURY_PRIVATE_KEY must belong to the configured recipient. Fee-sharing distribution follows all on-chain allocations, and only the treasury's finalized net SOL receipt counts toward packs. Cashback, native Pump holder rewards and non-SOL quotes remain unsupported. No creator-authority or recipient changes are attempted.

Holder selection policy: balances at the finalized snapshot immediately before the purchase job. Transfers after the snapshot do not change that job's winner. Exchange custody owners are not distinguishable from normal wallets without the explicit exclusion list. The operator must set any team, exchange or burn exclusions before enabling.

## Hosting

Run `npm start` in a persistent Node service (for example Railway). Mount a persistent volume and set `DATA_DIR` to its path. Set exactly one replica. Use the environment's `PORT`. `/api/health` exposes only readiness, missing variable names, and catalogue status; there are no public mutation routes.

The old `.openai/hosting.json` is a static-preview manifest and cannot host this Node worker. Do not deploy the `dist` directory alone: it requires `/api/state`. No external publication has been completed. Previous Sites upload approval remains unresolved.

## Recovery

Back up the SQLite database and its WAL as a consistent snapshot. Never delete the database to resolve a failed transaction: it contains funding accounting and prevents duplicate purchases. Operator details are stored in `state.worker.halted` and transaction signatures in `txs`; signed transaction bytes are also private server data. After a failure, stop the process, reconcile the recorded signature and Collector memo, then update the affected job/accounting deliberately. There is intentionally no public 'retry purchase' button. A stale `worker.lock` after an unclean shutdown can be removed only after confirming the previous process is stopped; retain the SQLite data.

The worker halts on uncertain financial outcomes. Automated recovery for expired transactions requires operator reconciliation and is not a guaranteed hands-off recovery mechanism. Provider/API instruction changes may trigger the strict purchase/swap validation guard and need an adapter update.

### Rate limits and safe resumption

RPC calls now share a serialized queue with at least 500 ms between request starts, including full holder snapshots. HTTP 429 and server errors use bounded retries and respect Retry-After. Sustained transient failures persist a cooldown of 30 seconds to 5 minutes (or longer when the provider requests it), keeping the fee ledger, chosen holder, daily budget and signed transaction journal intact.

On redeploy, a saved halt specifically caused by HTTP 429 can resume automatically after a cooldown. The worker checks the recorded signature and reuses the exact signed bytes; it never replaces a journaled transaction or redraws its winner. A finalized receipt is accounted with the job stage in the same saved worker record. Failed on-chain transactions, unresolved expired signatures, validation failures and interrupted Collector pack generation still require reconciliation. This update does not import old external deposits or reset any database.

Deploy the latest main commit with the same token, treasury and persistent volume. No new environment variables are required. The UI displays Paused, Processing or a retry countdown instead of leaving an overdue timer on Evaluating. A remaining halt prints safe stage/signature diagnostics in Railway logs. Run `npm run diagnose` through Railway SSH for the same read-only report; it does not load a private key, send transactions or alter the database. RPC quotas still apply: pacing cannot overcome an exhausted provider plan.

## Verification and limits

82 local tests pass, including RPC backoff, cooldown persistence, rate-limit recovery, fee preservation across database reopen, exact weighted selection, holder aggregation, recipient checks, exact USDC payment, 60-second selection tiers, carryover, equal-price alternation, persistent transaction reuse, interrupted generation, reveal gating, and a mocked purchase-to-delivery flow. JavaScript syntax checks pass. The public mainnet Collector Crypt catalogue has been fetched successfully and the page displays real prices and artwork.

Local tests do not use the deployed treasury key or API credentials. On 20 October 2026, the existing public mainnet $25 purchase and its finalized Metaplex Core delivery were inspected, and the new verifier confirmed the selected holder as the current on-chain asset owner. Deployed recovery and sustained unattended operation still require verification. Mock tests alone are not evidence of mainnet execution.

The dependency audit reports zero known vulnerabilities as of 19 October 2026. Jayson is pinned to 5.0.0, which removes the vulnerable streaming parser; RPC package loading is regression-tested. The native `bigint-buffer` path is replaced with a tested bounded pure-JavaScript codec. Installation scripts are disabled. See SECURITY-REVIEW.md for the review scope and remaining live-validation requirements.

## Official integration references

- https://docs.collectorcrypt.com/gacha/api
- https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/COLLECT_CREATOR_FEE.md
- https://developers.jup.ag/docs/api-reference/swap/v1/quote
- https://developers.jup.ag/docs/api-reference/swap/v1/swap

The current Jupiter integration uses the documented V1 ExactOut route for precise pack funding. Jupiter marks V1 as superseded by V2; a migration should be separately validated before changing the payment path.

## Redirected fees and existing deployments

Set MAIN_TOKEN_MINT to the launched token and TREASURY_PRIVATE_KEY to the recipient treasury wallet. Configure fee redirection on Pump.fun itself; the app detects the sharing config automatically. No launch-wallet private key or new fee-mode variable is required. Keep the treasury dedicated and funded for transaction costs. Only distributions executed and journaled by this worker are credited: fees already claimed externally, manual transfers and unrelated deposits are not automatically imported.

An identity left behind by an unsuccessful setup can be replaced automatically only if the database has no funds, jobs, snapshots, transaction records or history. Existing financial records block unapproved identity changes; the explicit same-treasury carryover below is the only supported migration. The legacy pumpdrop.sqlite filename stays unchanged so the PumpCards rebrand cannot lose the ledger. The website links to the supplied X account, @pumpcardsworld.

Fee-sharing support has local SDK/mocked regression coverage; the deployed recipient configuration and a funded distribution-to-pack cycle still need verification.

### Collector purchase memo recovery

Collector Crypt uses `<memo>:open` in its on-chain purchase memo (confirmed by an unsigned mainnet sample on 20 October 2026). The validator accepts this exact action suffix or the legacy bare memo, still requiring the exact USDC amount, approved destination and payer. Different actions, duplicate memos and modified amounts fail validation.

An existing `Pack payment or memo mismatch` halt can recover only in the purchase stage when the swap is finalized, no purchase journal exists, the saved payment passes all corrected validation checks, its treasury signature is empty, and Collector reports that exact checkout as unpaid with no send/buyback/refund activity. The old unsigned checkout is archived inside the saved job and a fresh checkout is requested for the same holder and pack. The existing USDC from the swap, fee ledger and daily budget reservation are retained; no second swap or draw occurs. Provider-generated transactions are never edited to replace their blockhash. Signed/paid purchases remain ineligible for this replacement. A new checkout's opening deadline is measured from its own generation time. An interrupted generation still requires reconciliation rather than another generation request.

### Metaplex Core collectible verification

Delivery verification supports standard SPL post-token balances and uncompressed Metaplex Core assets. Core verification requires a successful finalized transaction containing the official Core TransferV1 instruction for the exact asset and winner, followed by a finalized AssetV1 account read at or after that transaction slot. The account must be owned by the official Core program and name the selected holder as its owner. Provider metadata alone is insufficient. Compressed assets and other transfer formats still fail closed; if the holder has subsequently transferred the Core asset away, operator reconciliation is required.

A saved `NFT ownership not verified in finalized delivery` pause in the open stage can resume only after the recorded purchase is finalized, the provider links that purchase to the expected asset and recipient, and on-chain verification passes. This recovery retrieves the existing pack result; it does not generate another checkout, sign a payment, alter fee accounting or select another holder.

Layout references: https://github.com/metaplex-foundation/mpl-core/blob/main/clients/js/src/generated/instructions/transferV1.ts and https://github.com/metaplex-foundation/mpl-core/blob/main/clients/js/src/generated/accounts/assetV1.ts

### Carry the fee ledger to a new token

Set MAIN_TOKEN_MINT and CARRYOVER_TO_TOKEN_MINT to the same new public mint. Keep the same treasury private key, volume and DATA_DIR. Startup first validates the new token's creator/fee-sharing recipient configuration, then atomically records the old worker state in an audit entry and switches the stored identity. The remaining fee ledger, daily spending reservations, transaction journal, snapshots and history remain intact. This does not credit arbitrary treasury deposits.

A paid pack already in the open stage keeps its old winner and original-token attribution; it finishes before any future pack job. New jobs snapshot MAIN_TOKEN_MINT holders. Pending fee claims and purchases that have not finalized block migration, as do treasury changes. The option only authorizes the exact destination mint and is idempotent on redeploy. Remove CARRYOVER_TO_TOKEN_MINT after the successful migration log. Keep today's spending cap in mind: migration does not reset the daily total.

For the authorized migration:

```dotenv
MAIN_TOKEN_MINT=8n1bUSp2rmJZkLEqXzYZpwzCHTjRX3vZd1RjjsNGpump
CARRYOVER_TO_TOKEN_MINT=8n1bUSp2rmJZkLEqXzYZpwzCHTjRX3vZd1RjjsNGpump
```
