/**
 * What the relayer is willing to pay gas for. Every user action is a NEP-366 delegate
 * action; the relayer only wraps delegates whose receiver and methods are allowlisted,
 * with bounded deposits and gas, and within per-account and per-IP rate limits.
 */
export interface RelayConfig {
  registry: string;
  capVault: string;
  dropVault: string;
  token: string;
  /** testnet mock token exposes `faucet`; never enabled for a real token */
  allowFaucet: boolean;
  maxGasPerAction: bigint;
}

export interface FnCall {
  methodName: string;
  args: Uint8Array;
  gas: bigint;
  deposit: bigint;
}

export interface DelegateView {
  senderId: string;
  receiverId: string;
  calls: FnCall[] | null; // null if any action is not a FunctionCall
}

const ONE_YOCTO = 1n;
const STORAGE_DEPOSIT_MAX = 12_500_000_000_000_000_000_000n; // 0.0125 NEAR

export function allowedMethods(c: RelayConfig): Record<string, Set<string>> {
  return {
    [c.registry]: new Set(["buy_cap", "buy_drop", "claim_cap", "finalize_claim", "settle_drop", "retry_payout", "expire", "refund_sold_out", "withdraw_credit"]),
    [c.capVault]: new Set(["request_withdraw", "claim_withdrawal", "roll_epoch"]),
    [c.dropVault]: new Set(["request_withdraw", "claim_withdrawal", "roll_epoch"]),
    [c.token]: new Set(["ft_transfer_call", "storage_deposit", ...(c.allowFaucet ? ["faucet"] : [])]),
  };
}

export function checkDelegate(d: DelegateView, c: RelayConfig): string | null {
  const allow = allowedMethods(c)[d.receiverId];
  if (!allow) return `receiver ${d.receiverId} is not sponsored`;
  if (!d.calls || d.calls.length === 0) return "only function calls are sponsored";
  if (d.calls.length > 2) return "too many actions";
  for (const a of d.calls) {
    if (!allow.has(a.methodName)) return `method ${a.methodName} is not sponsored on ${d.receiverId}`;
    if (a.gas > c.maxGasPerAction) return "gas above limit";
    if (d.receiverId === c.token) {
      if (a.methodName === "ft_transfer_call") {
        if (a.deposit !== ONE_YOCTO) return "ft_transfer_call needs exactly 1 yoctoNEAR";
        let args: { receiver_id?: string };
        try {
          args = JSON.parse(new TextDecoder().decode(a.args));
        } catch {
          return "invalid args";
        }
        if (![c.registry, c.capVault, c.dropVault].includes(args.receiver_id ?? "")) return "token transfers only to CapFare contracts";
      } else if (a.methodName === "storage_deposit") {
        if (a.deposit > STORAGE_DEPOSIT_MAX) return "storage deposit too large";
      } else if (a.deposit !== 0n) return "no deposit allowed";
    } else if (a.deposit !== 0n) {
      return "no deposit allowed";
    }
  }
  return null;
}

/** Fixed-window counters per key. */
export class Quota {
  private m = new Map<string, { start: number; n: number }>();
  constructor(private limit: number, private windowMs: number) {}
  hit(key: string, now = Date.now()): boolean {
    const e = this.m.get(key);
    if (!e || now - e.start >= this.windowMs) {
      this.m.set(key, { start: now, n: 1 });
      return true;
    }
    if (e.n >= this.limit) return false;
    e.n++;
    return true;
  }
}

export function validSubName(name: string): boolean {
  return /^[a-z0-9]([a-z0-9-_]{1,30})[a-z0-9]$/.test(name) && !/[-_]{2}/.test(name);
}
