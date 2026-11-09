# Premium engine

The premium engine is not a separate contract. The public formula lives in
[`contracts/core/src/premium.rs`](../core/src/premium.rs) (pure, integer-only) and is executed
on-chain by the policy registry at purchase (`buy_cap`, `buy_drop`) and exposed as the view
`preview_premium`. Parameters are stored in the registry and changed only through the
timelocked `propose_params` → `apply_params` flow. See `docs/DECISIONS.md` (D1).
