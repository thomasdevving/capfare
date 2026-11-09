//! Prepaid credit: users top up USDC once (e.g. €20 via the ramp partner) and
//! premiums are debited from it, avoiding per-premium on-ramp minimums and fees.

use crate::ext::*;
use crate::*;
use near_sdk::{Promise, PromiseOrValue};

#[near]
impl PolicyRegistry {
    /// NEP-141 receiver: msg "top_up" credits the sender; {"top_up_for": {"account_id"}}
    /// credits another account (used by the ramp provider).
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        require!(env::predecessor_account_id() == self.token, "only the settlement token");
        let m: CreditMsg = serde_json::from_str(&msg).unwrap_or_else(|_| env::panic_str("invalid msg"));
        let who = match m {
            CreditMsg::TopUp => sender_id,
            CreditMsg::TopUpFor { account_id } => account_id,
        };
        self.add_credit(&who, amount.0);
        event("credit_top_up", json!({"account_id": who, "amount": amount}));
        PromiseOrValue::Value(U128(0))
    }

    /// Withdraws unused credit to the caller's wallet. Restored if the transfer fails.
    pub fn withdraw_credit(&mut self, amount: U128) -> Promise {
        let who = env::predecessor_account_id();
        require!(amount.0 > 0, "amount must be positive");
        self.sub_credit(&who, amount.0);
        self.in_flight += amount.0;
        ext_ft::ext(self.token.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(who.clone(), amount, Some("CapFare credit withdrawal".into()))
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_SMALL_CB).on_credit_withdrawn(who, amount))
    }

    #[private]
    pub fn on_credit_withdrawn(&mut self, account_id: AccountId, amount: U128) -> bool {
        self.in_flight -= amount.0;
        if promise_ok(0) {
            event("credit_withdrawn", json!({"account_id": account_id, "amount": amount}));
            true
        } else {
            self.add_credit(&account_id, amount.0);
            event("credit_withdrawal_reverted", json!({"account_id": account_id, "amount": amount}));
            false
        }
    }
}
