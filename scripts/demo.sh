#!/usr/bin/env bash
# CapFare scripted demo (brief section 13).
#   ./scripts/demo.sh            local NEAR sandbox: builds, deploys, runs services and the scenario
#   ./scripts/demo.sh --testnet  runs the scenario against deployments/testnet.json (services must be running)
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "${1:-}" == "--testnet" ]]; then
  NETWORK=testnet pnpm --silent --filter @capfare/scripts demo
  exit $?
fi
[[ -f contracts/target/near/capfare_policy_registry/capfare_policy_registry.wasm ]] || ./scripts/build-contracts.sh
[[ -f backtest/output/demo_params.json ]] || (cd backtest && python3 -m capfare_backtest.cli run --out output)
# Containers that cannot raise RLIMIT_NOFILE need the shim (see Makefile `shim`).
if [[ -f scripts/dev/librlimit_shim.so ]]; then export LD_PRELOAD="$PWD/scripts/dev/librlimit_shim.so"; fi
export STACK_QUIET=1
setsid pnpm --silent --filter @capfare/scripts stack > /tmp/capfare-stack.log 2>&1 &
STACK=$!
trap 'kill -TERM -- -$STACK 2>/dev/null || true; sleep 1; kill -KILL -- -$STACK 2>/dev/null || true' EXIT
for i in $(seq 1 180); do
  grep -q "stack ready" /tmp/capfare-stack.log 2>/dev/null && break
  if ! kill -0 $STACK 2>/dev/null; then cat /tmp/capfare-stack.log; exit 1; fi
  sleep 1
done
unset LD_PRELOAD
NETWORK=sandbox pnpm --silent --filter @capfare/scripts demo
