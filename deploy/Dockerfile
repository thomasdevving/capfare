# CapFare all-in-one demo container (Railway, Fly, any Docker host). Two modes:
#
#   CAPFARE_NETWORK=testnet  (recommended for a public demo; docs/TESTNET.md)
#     Uses the fixed NEAR testnet deployment in deployments/testnet.json (capfare.testnet).
#     Nothing is deployed at start, so accounts, policies and payouts survive redeploys and
#     anyone can check them on https://testnet.nearblocks.io. Needs the variables
#     CAPFARE_ACCOUNT_KEY, ORACLE_DEV_SEED, VERIFIER_DEV_SEED (secrets) and, to keep alert
#     settings across restarts, NOTIFIER_DATA_FILE on a volume (e.g. /data/notifier.json).
#     Set CAPFARE_NETWORK as a build variable too, so prebuilt pages show the right network.
#
#   CAPFARE_NETWORK=sandbox  (default; no secrets)
#     Local NEAR sandbox node -> contract deployment (prebuilt wasm in contracts/res) ->
#     services -> web app. Every page shows "Network: Local sandbox". State resets on restart.
#
# Price oracle and booking verifier run in demo mode with development keys in both modes
# (not inside a TEE); the Transparency page says so.
# Full Debian trixie image: ships gcc and curl (no apt step), and glibc ≥ 2.39 for near-sandbox.
ARG BASE_IMAGE=node:22-trixie
FROM ${BASE_IMAGE}
RUN npm install -g pnpm@10.0.0
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
# Railway passes service variables as build arguments. Use the public URL for
# prerendered metadata and label this all-in-one demo as a sandbox from first load.
ARG SITE_URL=http://localhost:3000
ARG CAPFARE_NETWORK=sandbox
# Optional: the Skyline Travel demo booking site's own public address (same app, host routing).
ARG SKYLINE_URL=
RUN SITE_URL=$SITE_URL CAPFARE_NETWORK=$CAPFARE_NETWORK SKYLINE_URL=$SKYLINE_URL pnpm --filter web build
# A ready extension build for this deployment, offered at /extension (download + install steps).
RUN CAPFARE_APP_URL=$SITE_URL CAPFARE_DEMO_SITE_URL=$SKYLINE_URL pnpm --filter @capfare/extension build \
 && pnpm --filter @capfare/extension run zip ../web/public/capfare-extension.zip
ENV CAPFARE_NETWORK=$CAPFARE_NETWORK
RUN gcc -shared -fPIC -o scripts/dev/librlimit_shim.so scripts/dev/rlimit_shim.c -ldl
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 STACK_QUIET=1
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=180s CMD curl -fs http://localhost:${PORT:-3000}/api/health || exit 1
CMD ["sh", "-c", "WEB_PORT=${PORT:-3000} LD_PRELOAD=/app/scripts/dev/librlimit_shim.so pnpm --filter @capfare/scripts stack -- --web"]
