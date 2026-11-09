use crate::*;

#[near]
impl PolicyRegistry {
    pub fn get_params(&self) -> Params {
        self.params.clone()
    }

    pub fn get_pending_params(&self) -> Option<PendingParams> {
        self.pending_params.clone()
    }

    /// The exact on-chain premium formula for explicit inputs. Used by the web app
    /// (quotes, hero chart) and by the UI-vs-contract conformance test.
    pub fn preview_premium(&self, inputs: PremiumInputs) -> PremiumBreakdown {
        compute_premium(self.params.product(inputs.product), &inputs).unwrap_or_else(|e| env::panic_str(e.msg()))
    }

    pub fn preview_payout_cap(&self, index_minor: u64, paid_minor: u64, strike_minor: u64) -> u64 {
        cap_payout(index_minor, paid_minor, strike_minor, self.params.cap.deductible, self.params.cap.max_payout)
    }

    pub fn preview_payout_drop(&self, paid_minor: u64, lowest_minor: u64) -> u64 {
        drop_payout(paid_minor, lowest_minor, self.params.drop.deductible, self.params.drop.max_payout)
    }

    pub fn flight_key_hash(&self, flight_key: FlightKey) -> Hash32 {
        if let Err(e) = flight_key.validate() {
            env::panic_str(e);
        }
        capfare_core::flight_key_hash(&flight_key)
    }

    pub fn get_policy(&self, policy_id: u64) -> Option<Policy> {
        self.policies.get(&policy_id).cloned()
    }

    pub fn get_policies_by_owner(&self, account_id: AccountId, from_index: Option<u32>, limit: Option<u32>) -> Vec<Policy> {
        let ids = self.owner_policies.get(&account_id).cloned().unwrap_or_default();
        ids.iter()
            .rev()
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit.unwrap_or(50).min(100) as usize)
            .filter_map(|id| self.policies.get(id).cloned())
            .collect()
    }

    /// Policies that still need oracle coverage or a settlement (Active / Claimed).
    pub fn get_active_policies(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<Policy> {
        self.active
            .iter()
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit.unwrap_or(100).min(200) as usize)
            .filter_map(|id| self.policies.get(id).cloned())
            .collect()
    }

    pub fn get_credit(&self, account_id: AccountId) -> U128 {
        U128(self.credit_of(&account_id))
    }

    /// (outstanding max payouts on this flight, cap), cents.
    pub fn get_flight_exposure(&self, product: Product, flight_key_hash: Hash32) -> (u64, u64) {
        (
            self.flight_exposure.get(&(product, flight_key_hash)).copied().unwrap_or(0),
            self.params.product(product).flight_exposure_cap,
        )
    }

    pub fn get_route_week_exposure(&self, product: Product, origin: String, destination: String, departure_ts: u64) -> (u64, u64) {
        let k = route_week_key(&origin, &destination, departure_ts);
        (
            self.route_week_exposure.get(&(product, k)).copied().unwrap_or(0),
            self.params.product(product).route_week_exposure_cap,
        )
    }

    pub fn get_stats(&self) -> Stats {
        Stats {
            policies_total: self.policies_total,
            active_cap: self.active_cap,
            active_drop: self.active_drop,
            credit_total: U128(self.credit_total),
            in_flight: U128(self.in_flight),
            paused: self.paused,
        }
    }

    /// The registry's USDC balance should equal this (accounting identity).
    pub fn get_expected_token_balance(&self) -> U128 {
        U128(self.credit_total + self.in_flight)
    }

    pub fn get_config(&self) -> serde_json::Value {
        json!({
            "owner": self.owner,
            "token": self.token,
            "attestation": self.attestation,
            "cap_vault": self.cap_vault,
            "drop_vault": self.drop_vault,
            "paused": self.paused,
        })
    }
}
