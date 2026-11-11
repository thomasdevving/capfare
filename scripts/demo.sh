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
# Fresh builds if present, else the committed prebuilt wasm in contracts/res (no Rust toolchain needed).
[[ -f contracts/target/near/capfare_policy_registry/capfare_policy_registry.wasm || -f contracts/res/capfare_policy_registry.wasm ]] || ./scripts/build-contracts.sh
[[ -f backtest/output/demo_params.json ]] || (cd backtest && python3 -m capfare_backtest.cli run --out output)
# The sandbox node wants 65535 open files; containers that cannot raise the limit need the shim
# (see Makefile `shim`). Build it on the fly when the hard limit is lower and gcc is there.
if [[ ! -f scripts/dev/librlimit_shim.so ]] && [[ "$(ulimit -Hn)" != "unlimited" ]] && (( $(ulimit -Hn) < 65535 )) && command -v gcc >/dev/null; then
  gcc -shared -fPIC -o scripts/dev/librlimit_shim.so scripts/dev/rlimit_shim.c -ldl
fi
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
