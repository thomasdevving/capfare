# CapFare on NEAR testnet

CapFare is deployed on NEAR testnet under **`capfare.testnet`**. Everything below can be checked
on [NearBlocks](https://testnet.nearblocks.io), the public NEAR explorer. No mainnet, no real money.

| Contract | Account | Explorer |
|---|---|---|
| Policy registry (premium engine, policies, claims, credit) | `registry.v2.capfare.testnet` | [view](https://testnet.nearblocks.io/address/registry.v2.capfare.testnet) |
| Price Cap vault | `cap.v2.capfare.testnet` | [view](https://testnet.nearblocks.io/address/cap.v2.capfare.testnet) |
| Drop Guarantee vault | `drop.v2.capfare.testnet` | [view](https://testnet.nearblocks.io/address/drop.v2.capfare.testnet) |
| Attestation registry (service keys, price snapshots, booking attestations) | `att.v2.capfare.testnet` | [view](https://testnet.nearblocks.io/address/att.v2.capfare.testnet) |
| Test USDC (mock NEP-141 with a faucet) | `usdc.v2.capfare.testnet` | [view](https://testnet.nearblocks.io/address/usdc.v2.capfare.testnet) |
| Root, relayer and fee account | `capfare.testnet` | [view](https://testnet.nearblocks.io/address/capfare.testnet) |

The current contracts (v2: deductible and duration choices, renewals, flexible cover, the
24-hour live-check rule) live under `v2.capfare.testnet`. The first deployment
(`registry.capfare.testnet` and its siblings) stays on-chain unchanged as history.

The public record is [`deployments/testnet.json`](../deployments/testnet.json). Users get named
accounts under the relayer (`alice.capfare.testnet`), so a traveller's purchases, claims and
payouts are listed on their own account page. In the web app every transaction shows a
"View on NearBlocks" link, the Transparency page links every contract, and the policies page
links your account.

## What is real here and what is demo

* **Real on testnet:** the contracts (same code as the tests; prebuilt wasm in `contracts/res`
  with SHA-256 sums), full collateralisation of every policy, premiums from the on-chain
  formula, claims, payouts, LP deposits and withdrawals, gasless meta-transactions through
  the relayer, named accounts.
* **Demo on this deployment, and labelled as such:** prices come from the demo price source
  (the attestation registry was created with `allow_demo_sources: true`, visible in its config);
  test USDC is a mock token anyone can mint through the app's faucet; vault epochs are 30 seconds
  and key timelocks 5 seconds so the flows can be tried in minutes.
* **Not in a TEE yet:** the price oracle and booking verifier sign with **development keys**.
  They run the same code that is built to run in an Intel TDX confidential VM (dstack), but here
  you trust CapFare's server. Their keys are registered on-chain through the same timelocked
  process an enclave key would use; the Transparency page shows them as development keys.

## Run the app against testnet

The services need three secrets, kept in the git-ignored `deployments/testnet.secrets.json`
created by the deploy script (ask the maintainer; never commit them):

```bash
export CAPFARE_ACCOUNT_KEY=ed25519:… ORACLE_DEV_SEED=… VERIFIER_DEV_SEED=…
```

```bash
pnpm --filter @capfare/scripts stack -- --testnet --web
```

The default RPC is FastNear's public testnet endpoint (`https://test.rpc.fastnear.com`);
`rpc.testnet.near.org` is deprecated and rate-limits. Override with `NEAR_RPC_URL`.
Behind an HTTPS proxy, add `NODE_USE_ENV_PROXY=1` (Node's built-in fetch ignores the proxy
otherwise). On start the stack checks that the running services sign with the keys registered
in `att.v2.capfare.testnet` and stops if they don't.

## Host the public demo on testnet (Railway or any Docker host)

The image in `deploy/Dockerfile` runs either mode. For testnet, set these service variables:

| Variable | Value | Notes |
|---|---|---|
| `CAPFARE_NETWORK` | `testnet` | also as a **build** variable, so prebuilt pages show "NEAR testnet" |
| `CAPFARE_ACCOUNT_KEY` | from `testnet.secrets.json` | secret; a separate full-access key of `capfare.testnet` that can be removed on its own |
| `ORACLE_DEV_SEED` | from `testnet.secrets.json` | secret |
| `VERIFIER_DEV_SEED` | from `testnet.secrets.json` | secret |
| `SITE_URL` | the public URL | build and runtime |
| `NOTIFIER_DATA_FILE` | `/data/notifier.json` | with a volume mounted at `/data`, alert settings and watches survive redeploys |

Nothing is deployed when the container starts, so redeploys no longer reset accounts, policies
or balances: they live on testnet.

## Deploy a fresh copy (maintainers)

```bash
NODE_USE_ENV_PROXY=1 ROOT_NAME=capfare.testnet TARGET_NEAR=38 pnpm --filter @capfare/scripts exec tsx src/testnet-fund.ts
```

```bash
DEPLOY_PREFIX=v2 NODE_USE_ENV_PROXY=1 pnpm --filter @capfare/scripts exec tsx src/testnet-deploy.ts
```

`DEPLOY_PREFIX` puts a new version under `<prefix>.capfare.testnet` next to the old one. The
contract accounts' key is saved in `deployments/testnet.keys.json` (needed to upgrade them).

`testnet-fund.ts` creates the root account through the public testnet faucet and merges further
faucet accounts into it (10 NEAR each); the deployment needs about 25 NEAR, and the relayer
spends 0.05 NEAR per new user account plus gas. `testnet-deploy.ts` registers the services'
keys, adds the hosted key, deploys and seeds the contracts, and writes `deployments/testnet.json`
(committed) and `deployments/testnet.secrets.json` (git-ignored, mode 600).
