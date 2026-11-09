# CapFare top-level tasks. See README.md for details.
SHIM := $(CURDIR)/scripts/dev/librlimit_shim.so

.PHONY: all contracts test test-contracts test-integration test-ts test-backtest backtest web demo-local clean

all: contracts

contracts:
	./scripts/build-contracts.sh

test: test-contracts test-ts test-backtest

test-contracts:
	cd contracts && cargo test --workspace --exclude capfare-integration-tests

# Sandbox integration tests (downloads near-sandbox on first run).
# In containers that cannot raise RLIMIT_NOFILE, build the shim: make shim
test-integration: contracts
	cd contracts && $(if $(wildcard $(SHIM)),LD_PRELOAD=$(SHIM)) cargo test -p capfare-integration-tests -- --test-threads=1

shim:
	gcc -shared -fPIC -o $(SHIM) scripts/dev/rlimit_shim.c -ldl

test-ts:
	pnpm -r test

test-backtest:
	cd backtest && python -m pytest -q

backtest:
	cd backtest && python -m capfare_backtest.cli run --out output

web:
	pnpm --filter web dev

demo-local:
	./scripts/demo.sh --sandbox

clean:
	cd contracts && cargo clean
