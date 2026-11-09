//! "Test USDC" — a NEP-141 token used for CapFare demos and sandbox tests when the
//! official testnet USDC cannot be minted programmatically. 6 decimals.
//!
//! Failure injection (for tests of async rollback): transfers *to* accounts in
//! `blocked` panic, exactly like a transfer to an unregistered account would.

use near_contract_standards::fungible_token::metadata::{FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC};
use near_contract_standards::fungible_token::{FungibleToken, FungibleTokenCore, FungibleTokenResolver};
use near_contract_standards::storage_management::{StorageBalance, StorageBalanceBounds, StorageManagement};
use near_sdk::json_types::U128;
use near_sdk::store::IterableSet;
use near_sdk::{env, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault, PromiseOrValue};

#[derive(BorshStorageKey)]
#[near]
enum Key {
    Token,
    Blocked,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct MockFt {
    token: FungibleToken,
    owner: AccountId,
    blocked: IterableSet<AccountId>,
    /// Max amount `faucet` gives per call (0 disables the faucet).
    faucet_amount: u128,
}

#[near]
impl MockFt {
    #[init]
    pub fn new(owner: AccountId, faucet_amount: U128) -> Self {
        Self { token: FungibleToken::new(Key::Token), owner, blocked: IterableSet::new(Key::Blocked), faucet_amount: faucet_amount.0 }
    }

    fn check(&self, receiver: &AccountId) {
        require!(!self.blocked.contains(receiver), "receiver blocked (failure injection)");
    }

    pub fn mint(&mut self, account_id: AccountId, amount: U128) {
        require!(env::predecessor_account_id() == self.owner, "only the owner");
        if !self.token.accounts.contains_key(&account_id) {
            self.token.internal_register_account(&account_id);
        }
        self.token.internal_deposit(&account_id, amount.0);
        near_contract_standards::fungible_token::events::FtMint { owner_id: &account_id, amount, memo: Some("mint") }.emit();
    }

    /// Testnet faucet: registers the caller if needed and gives `faucet_amount`.
    pub fn faucet(&mut self) {
        require!(self.faucet_amount > 0, "faucet disabled");
        let a = env::predecessor_account_id();
        if !self.token.accounts.contains_key(&a) {
            self.token.internal_register_account(&a);
        }
        self.token.internal_deposit(&a, self.faucet_amount);
    }

    pub fn set_blocked(&mut self, account_id: AccountId, blocked: bool) {
        require!(env::predecessor_account_id() == self.owner, "only the owner");
        if blocked {
            self.blocked.insert(account_id);
        } else {
            self.blocked.remove(&account_id);
        }
    }
}

#[near]
impl FungibleTokenCore for MockFt {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.check(&receiver_id);
        self.token.ft_transfer(receiver_id, amount, memo)
    }

    #[payable]
    fn ft_transfer_call(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>, msg: String) -> PromiseOrValue<U128> {
        self.check(&receiver_id);
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for MockFt {
    #[private]
    fn ft_resolve_transfer(&mut self, sender_id: AccountId, receiver_id: AccountId, amount: U128) -> U128 {
        let (used, _burned) = self.token.internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        used.into()
    }
}

#[near]
impl StorageManagement for MockFt {
    #[payable]
    fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        self.token.internal_storage_unregister(force).is_some()
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for MockFt {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name: "Test USDC (CapFare testnet mock)".to_string(),
            symbol: "tUSDC".to_string(),
            icon: None,
            reference: None,
            reference_hash: None,
            decimals: 6,
        }
    }
}
