#!/usr/bin/env bash
# Builds all CapFare contracts to contracts/target/near/<crate>/<crate>.wasm
set -euo pipefail
cd "$(dirname "$0")/../contracts"
for c in mock_ft vault attestation_registry policy_registry; do
  (cd "$c" && cargo near build non-reproducible-wasm --no-abi)
done
ls -la target/near/*/*.wasm
