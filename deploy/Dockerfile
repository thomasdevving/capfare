# CapFare all-in-one demo container (Railway, Fly, any Docker host).
# Runs: local NEAR sandbox node -> contract deployment (prebuilt wasm in contracts/res) ->
# price_oracle + booking_verifier (demo mode, development keys) -> relayer -> web app.
# Every page shows "Network: Local sandbox". State resets on each restart.
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
RUN SITE_URL=$SITE_URL CAPFARE_NETWORK=sandbox pnpm --filter web build
RUN gcc -shared -fPIC -o scripts/dev/librlimit_shim.so scripts/dev/rlimit_shim.c -ldl
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 STACK_QUIET=1
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=180s CMD curl -fs http://localhost:${PORT:-3000}/api/health || exit 1
CMD ["sh", "-c", "WEB_PORT=${PORT:-3000} LD_PRELOAD=/app/scripts/dev/librlimit_shim.so pnpm --filter @capfare/scripts stack -- --web"]
