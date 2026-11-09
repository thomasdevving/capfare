use super::*;
use near_sdk::test_utils::{accounts, VMContextBuilder};
use near_sdk::{testing_env, PromiseResult, RuntimeFeesConfig};
use near_sdk::test_vm_config;
use proptest::prelude::*;
use std::collections::HashMap;

const DAY: u64 = 86_400;

fn token() -> AccountId { "usdc.test".parse().unwrap() }
fn registry() -> AccountId { "registry.test".parse().unwrap() }
fn vault_id() -> AccountId { "vault.test".parse().unwrap() }

struct Harness {
    v: Vault,
    now: u64,
    /// Model of the vault's USDC balance on the token contract.
    balance: u128,
    /// Model of everyone's USDC balance received from the vault.
    received: HashMap<AccountId, u128>,
}

impl Harness {
    fn ctx(&self, predecessor: AccountId, results: Vec<PromiseResult>) {
        let mut b = VMContextBuilder::new();
        b.current_account_id(vault_id())
            .predecessor_account_id(predecessor)
            .block_timestamp(self.now * 1_000_000_000)
            .attached_deposit(NearToken::from_yoctonear(1));
        testing_env!(b.build(), test_vm_config(), RuntimeFeesConfig::test(), Default::default(), results);
    }

    fn new() -> Self {
        let now = 1_800_000_000u64;
        let mut b = VMContextBuilder::new();
        b.current_account_id(vault_id()).predecessor_account_id(accounts(0)).block_timestamp(now * 1_000_000_000);
        // Fresh storage per harness (testing_env! carries storage over).
        near_sdk::mock::with_mocked_blockchain(|bc| { bc.take_storage(); });
        testing_env!(b.build());
        let v = Vault::new(accounts(0), "cap_vault".into(), token(), registry(), accounts(5), 7 * DAY, U128(1_000_000));
        Harness { v, now, balance: 0, received: HashMap::new() }
    }

    fn deposit(&mut self, who: AccountId, amount: u128) {
        self.ctx(token(), vec![]);
        let r = self.v.ft_on_transfer(who, U128(amount), "\"deposit\"".into());
        assert!(matches!(r, PromiseOrValue::Value(U128(0))));
        self.balance += amount;
    }

    fn sell(&mut self, id: u64, premium: u128, lock: u128) -> bool {
        self.ctx(token(), vec![]);
        let msg = format!("{{\"policy\":{{\"policy_id\":{id},\"lock\":\"{lock}\",\"fee_bps\":500}}}}");
        match self.v.ft_on_transfer(registry(), U128(premium), msg) {
            PromiseOrValue::Value(U128(0)) => { self.balance += premium; true }
            PromiseOrValue::Value(U128(x)) => { assert_eq!(x, premium); false }
            _ => panic!(),
        }
    }

    fn roll(&mut self) {
        self.now += 7 * DAY;
        self.ctx(accounts(4), vec![]);
        self.v.roll_epoch();
    }

    fn payout(&mut self, id: u64, to: AccountId, amount: u128, transfer_ok: bool) -> bool {
        self.ctx(registry(), vec![]);
        let r = self.v.payout(id, to.clone(), U128(amount));
        if let PromiseOrValue::Value(b) = r { return b; }
        let res = if transfer_ok { PromiseResult::Successful(vec![]) } else { PromiseResult::Failed };
        self.ctx(vault_id(), vec![res]);
        let ok = self.v.on_payout_transfer(id, U128(amount));
        assert_eq!(ok, transfer_ok);
        if ok { self.balance -= amount; *self.received.entry(to).or_default() += amount; }
        ok
    }

    fn claim(&mut self, who: AccountId, transfer_ok: bool) {
        let amt = self.v.get_claimable(who.clone()).0;
        if amt == 0 { return; }
        self.ctx(who.clone(), vec![]);
        let _ = self.v.claim_withdrawal();
        let res = if transfer_ok { PromiseResult::Successful(vec![]) } else { PromiseResult::Failed };
        self.ctx(vault_id(), vec![res]);
        self.v.on_claim_transfer(who.clone(), U128(amt));
        if transfer_ok { self.balance -= amt; *self.received.entry(who).or_default() += amt; }
    }

    fn check(&self) {
        let s = self.v.get_state();
        assert!(s.invariant_ok, "invariant");
        assert!(s.total_assets.0 >= s.locked_coverage.0 + s.pending_withdrawals.0);
        assert_eq!(self.v.get_expected_token_balance().0, self.balance, "accounting identity");
        assert_eq!(s.in_flight.0, 0);
    }
}

#[test]
fn deposit_then_epoch_mints_shares() {
    let mut h = Harness::new();
    h.deposit(accounts(1), 1_000_000_000);
    assert_eq!(h.v.get_state().total_assets.0, 0);
    h.roll();
    let s = h.v.get_state();
    assert_eq!(s.total_assets.0, 1_000_000_000);
    assert!(h.v.get_shares(accounts(1)).0 > 0);
    h.check();
}

#[test]
fn full_collateralisation_enforced() {
    let mut h = Harness::new();
    h.deposit(accounts(1), 100_000_000);
    h.roll();
    assert!(h.sell(1, 9_000_000, 60_000_000));
    // Only 40 USDC free: a 60 USDC lock must be refused (premium refunded).
    assert!(!h.sell(2, 9_000_000, 60_000_000));
    h.check();
}

#[test]
fn payout_and_release_flow() {
    let mut h = Harness::new();
    h.deposit(accounts(1), 1_000_000_000);
    h.roll();
    assert!(h.sell(1, 9_720_000, 108_000_000));
    assert!(h.payout(1, accounts(2), 70_200_000, true));
    let s = h.v.get_state();
    assert_eq!(s.locked_coverage.0, 0);
    assert_eq!(s.active_positions, 0);
    // fee 5% of premium, rounded up
    assert_eq!(s.fees_accrued.0, 486_000);
    assert_eq!(s.total_assets.0, 1_000_000_000 + 9_720_000 - 486_000 - 70_200_000);
    h.check();
}

#[test]
fn failed_payout_transfer_rolls_back() {
    let mut h = Harness::new();
    h.deposit(accounts(1), 1_000_000_000);
    h.roll();
    assert!(h.sell(1, 9_720_000, 108_000_000));
    let before = h.v.get_state();
    assert!(!h.payout(1, accounts(2), 70_200_000, false));
    let after = h.v.get_state();
    assert_eq!(before.total_assets, after.total_assets);
    assert_eq!(before.locked_coverage, after.locked_coverage);
    assert_eq!(h.v.get_position(1).unwrap().lock.0, 108_000_000);
    assert!(!h.v.get_position(1).unwrap().busy);
    h.check();
    // And it can be retried.
    assert!(h.payout(1, accounts(2), 70_200_000, true));
    h.check();
}

#[test]
fn failed_withdrawal_claim_restores_claimable() {
    let mut h = Harness::new();
    h.deposit(accounts(1), 100_000_000);
    h.roll();
    let shares = h.v.get_shares(accounts(1));
    h.ctx(accounts(1), vec![]);
    h.v.request_withdraw(shares);
    h.roll();
    let c = h.v.get_claimable(accounts(1)).0;
    assert!(c > 99_000_000);
    h.claim(accounts(1), false);
    assert_eq!(h.v.get_claimable(accounts(1)).0, c);
    h.check();
    h.claim(accounts(1), true);
    assert_eq!(h.v.get_claimable(accounts(1)).0, 0);
    h.check();
}

#[test]
#[should_panic(expected = "not enough free liquidity")]
fn cannot_withdraw_locked_coverage() {
    let mut h = Harness::new();
    h.deposit(accounts(1), 100_000_000);
    h.roll();
    assert!(h.sell(1, 9_000_000, 90_000_000));
    let shares = h.v.get_shares(accounts(1));
    h.ctx(accounts(1), vec![]);
    h.v.request_withdraw(shares);
}

#[test]
#[should_panic(expected = "only the policy registry")]
fn only_registry_pays() {
    let mut h = Harness::new();
    h.ctx(accounts(3), vec![]);
    let _ = h.v.payout(1, accounts(3), U128(1));
}

#[test]
#[should_panic(expected = "epoch has not ended")]
fn no_early_epoch() {
    let mut h = Harness::new();
    h.ctx(accounts(3), vec![]);
    h.v.roll_epoch();
}

#[test]
fn first_depositor_cannot_inflate_share_price() {
    let mut h = Harness::new();
    h.deposit(accounts(1), 1_000_000); // attacker, minimum
    h.roll();
    // Attacker "donates" via premiums they control is not possible; the classic
    // donation attack (plain transfer) does not change total_assets at all.
    h.balance += 1_000_000_000; // untracked transfer
    h.deposit(accounts(2), 500_000_000);
    h.roll();
    let v2 = h.v.get_share_value(accounts(2)).0;
    assert!(v2 >= 499_999_000, "victim lost value: {v2}");
}

#[derive(Debug, Clone)]
enum Action {
    Deposit(u8, u64),
    RequestWithdraw(u8, u8),
    Roll,
    Sell(u64, u64),
    Payout(u8, u8, bool),
    Release(u8),
    Refund(u8, bool),
    Claim(u8, bool),
}

fn action() -> impl Strategy<Value = Action> {
    prop_oneof![
        (0u8..3, 1_000_000u64..2_000_000_000).prop_map(|(a, x)| Action::Deposit(a, x)),
        (0u8..3, 1u8..=100).prop_map(|(a, p)| Action::RequestWithdraw(a, p)),
        Just(Action::Roll),
        (100_000u64..20_000_000, 20_000_000u64..300_000_000).prop_map(|(p, l)| Action::Sell(p, l)),
        (0u8..20, 0u8..=100, any::<bool>()).prop_map(|(i, f, ok)| Action::Payout(i, f, ok)),
        (0u8..20).prop_map(Action::Release),
        (0u8..20, any::<bool>()).prop_map(|(i, ok)| Action::Refund(i, ok)),
        (0u8..3, any::<bool>()).prop_map(|(a, ok)| Action::Claim(a, ok)),
    ]
}

fn lp(i: u8) -> AccountId { accounts((i + 1) as usize) }

proptest! {
    #![proptest_config(ProptestConfig { cases: 128, .. ProptestConfig::default() })]
    #[test]
    fn random_sequences_keep_invariants(actions in prop::collection::vec(action(), 1..60)) {
        let mut h = Harness::new();
        let mut next_id = 0u64;
        let mut live: Vec<u64> = vec![];
        for a in actions {
            match a {
                Action::Deposit(i, x) => h.deposit(lp(i), x as u128),
                Action::RequestWithdraw(i, pct) => {
                    let s = h.v.get_shares(lp(i)).0 * pct as u128 / 100;
                    let reserved = if s > 0 { h.v.value_of_shares_ceil(s).min(h.v.total_assets) } else { 0 };
                    if s > 0 && reserved <= h.v.free_liquidity_raw() {
                        h.ctx(lp(i), vec![]);
                        h.v.request_withdraw(U128(s));
                    }
                }
                Action::Roll => {
                    // Share price must not fall across an epoch roll (no losses happen inside it).
                    let (a0, s0) = (h.v.total_assets + VIRTUAL_ASSETS, h.v.total_shares + VIRTUAL_SHARES);
                    h.roll();
                    let (a1, s1) = (h.v.total_assets + VIRTUAL_ASSETS, h.v.total_shares + VIRTUAL_SHARES);
                    prop_assert!(a1 * s0 + s0.max(s1) >= a0 * s1, "share price diluted");
                }
                Action::Sell(p, l) => {
                    next_id += 1;
                    if h.sell(next_id, p as u128, l as u128) { live.push(next_id); }
                }
                Action::Payout(i, frac, ok) => {
                    if live.is_empty() { continue; }
                    let id = live[i as usize % live.len()];
                    let lock = h.v.get_position(id).unwrap().lock.0;
                    let amt = lock * frac as u128 / 100;
                    if h.payout(id, accounts(5), amt, ok) { live.retain(|x| *x != id); }
                }
                Action::Release(i) => {
                    if live.is_empty() { continue; }
                    let id = live[i as usize % live.len()];
                    h.ctx(registry(), vec![]);
                    h.v.release(id);
                    live.retain(|x| *x != id);
                }
                Action::Refund(i, ok) => {
                    if live.is_empty() { continue; }
                    let id = live[i as usize % live.len()];
                    let prem = h.v.get_position(id).unwrap().premium.0;
                    h.ctx(registry(), vec![]);
                    let _ = h.v.refund_premium(id, accounts(5));
                    let res = if ok { PromiseResult::Successful(vec![]) } else { PromiseResult::Failed };
                    h.ctx(vault_id(), vec![res]);
                    prop_assert_eq!(h.v.on_refund_transfer(id), ok);
                    if ok { h.balance -= prem; live.retain(|x| *x != id); }
                }
                Action::Claim(i, ok) => h.claim(lp(i), ok),
            }
            h.check();
        }
    }
}
