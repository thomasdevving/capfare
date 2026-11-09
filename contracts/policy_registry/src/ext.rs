use capfare_core::*;
use near_sdk::json_types::U128;
use near_sdk::{ext_contract, AccountId};

#[ext_contract(ext_ft)]
pub trait Ft {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
    fn ft_transfer_call(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>, msg: String) -> U128;
}

#[ext_contract(ext_vault)]
pub trait VaultExt {
    fn get_state(&self);
    fn payout(&mut self, policy_id: u64, receiver_id: AccountId, amount: U128) -> bool;
    fn refund_premium(&mut self, policy_id: u64, receiver_id: AccountId) -> bool;
}

#[ext_contract(ext_att)]
pub trait AttestationExt {
    fn get_latest_snapshot(&self, flight_key_hash: Hash32);
    fn consume_booking(
        &mut self,
        attestation: SignedBookingAttestation,
        product: Product,
        max_age_secs: u64,
        index_max_age_secs: u64,
        index_key: Option<Hash32>,
    );
    fn release_nullifier(&mut self, product: Product, nullifier: Hash32, flight_key_hash: Hash32);
    #[allow(clippy::too_many_arguments)]
    fn check_status(
        &self,
        attestation: SignedBookingAttestation,
        nullifier: Hash32,
        flight_key_hash: Hash32,
        passenger_commitment: Hash32,
        require_live: bool,
        min_verified_at: u64,
        max_age_secs: u64,
        low_from: Option<u64>,
        low_to: Option<u64>,
    );
}
