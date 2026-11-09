#!/usr/bin/env bash
# Builds all CapFare contracts to contracts/target/near/<crate>/<crate>.wasm
set -euo pipefail
cd "$(dirname "$0")/../contracts"
for c in mock_ft vault attestation_registry policy_registry; do
  (cd "$c" && cargo near build non-reproducible-wasm --no-abi)
done
mkdir -p res
for c in capfare_mock_ft capfare_vault capfare_attestation_registry capfare_policy_registry; do cp "target/near/$c/$c.wasm" res/; done
(cd res && sha256sum *.wasm > SHA256SUMS)
ls -la res
