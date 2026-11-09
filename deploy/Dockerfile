# CapFare all-in-one demo container (Railway, Fly, any Docker host).
# Runs: local NEAR sandbox node -> contract deployment (prebuilt wasm in contracts/res) ->
# price_oracle + booking_verifier (demo mode, development keys) -> relayer -> web app.
# Every page shows "Network: Local sandbox". State resets on each restart.
# Full bookworm image: ships gcc and curl, so no apt step is needed.
FROM node:22-bookworm
RUN --mount=type=secret,id=ca,required=false sh -c 'if [ -s /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi; npm install -g pnpm@10.0.0'
WORKDIR /app
COPY . .
# Optional extra CA (only for builds behind a TLS-intercepting proxy): --secret id=ca,src=...
RUN --mount=type=secret,id=ca,required=false sh -c 'if [ -s /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi; pnpm install --frozen-lockfile' 
RUN --mount=type=secret,id=ca,required=false sh -c 'if [ -s /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi; pnpm --filter web build'
RUN gcc -shared -fPIC -o scripts/dev/librlimit_shim.so scripts/dev/rlimit_shim.c -ldl
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 STACK_QUIET=1
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=180s CMD curl -fs http://localhost:${PORT:-3000}/api/health || exit 1
CMD ["sh", "-c", "WEB_PORT=${PORT:-3000} LD_PRELOAD=/app/scripts/dev/librlimit_shim.so pnpm --filter @capfare/scripts stack -- --web"]
