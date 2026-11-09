/**
 * Fiat on/off-ramp abstraction. CapFare never touches fiat: a licensed provider takes
 * the payment (iDEAL, card, SEPA) and delivers USDC to the user's credit, or receives
 * USDC and pays out to an IBAN.
 *
 * - MockRampProvider (testnet): simulates the payment and sends test USDC to the user's
 *   CapFare credit from the ramp account. No money moves.
 * - LicensedRampProvider: adapter skeleton for a real provider (documented in docs/LEGAL.md).
 */
import { Account, actions, JsonRpcProvider, KeyPairSigner, teraToGas, type KeyPairString } from "near-api-js";
import { serverConfig } from "./config";

export interface TopUpRequest {
  accountId: string;
  amountEurCents: number;
  method: "ideal" | "card";
}
export interface TopUpResult {
  id: string;
  status: "paid" | "pending" | "failed";
  usdcMicro: string;
  txHash?: string;
  provider: string;
  simulated: boolean;
}
export interface PayoutRequest {
  accountId: string;
  amountUsdcMicro: string;
  ibanMasked: string;
}
export interface PayoutResult {
  id: string;
  status: "accepted" | "rejected";
  provider: string;
  simulated: boolean;
  message: string;
}

export interface RampProvider {
  name: string;
  createTopUp(r: TopUpRequest): Promise<TopUpResult>;
  createPayout(r: PayoutRequest): Promise<PayoutResult>;
  /** Verifies and applies a provider webhook (payment completed, payout settled). */
  handleWebhook(headers: Headers, rawBody: string): Promise<{ ok: boolean }>;
}

export class MockRampProvider implements RampProvider {
  name = "mock (testnet)";

  async createTopUp(r: TopUpRequest): Promise<TopUpResult> {
    const c = serverConfig();
    if (!c.rampAccountId || !c.rampPrivateKey) throw new Error("mock ramp is not configured on this deployment");
    if (r.amountEurCents < 500 || r.amountEurCents > 10_000) throw new Error("top-ups between €5 and €100 on testnet");
    const params = await (await import("./chain")).overview().then((o) => o.params);
    const micro = BigInt(r.amountEurCents) * BigInt(params.global.usdc_micro_per_cent);
    const acct = new Account(c.rampAccountId, new JsonRpcProvider({ url: c.rpcUrl }), KeyPairSigner.fromSecretKey(c.rampPrivateKey as KeyPairString));
    // Mock token: the ramp account is the token owner and can mint test USDC.
    await acct.signAndSendTransaction({
      receiverId: c.token,
      actions: [actions.functionCall("mint", { account_id: c.rampAccountId, amount: micro.toString() }, teraToGas(30), 0n)],
    });
    const tx: any = await acct.signAndSendTransaction({
      receiverId: c.token,
      actions: [
        actions.functionCall(
          "ft_transfer_call",
          { receiver_id: c.registry, amount: micro.toString(), msg: JSON.stringify({ top_up_for: { account_id: r.accountId } }) },
          teraToGas(100),
          1n,
        ),
      ],
    });
    return { id: `mock_${Date.now()}`, status: "paid", usdcMicro: micro.toString(), txHash: tx?.transaction?.hash, provider: this.name, simulated: true };
  }

  async createPayout(r: PayoutRequest): Promise<PayoutResult> {
    if (!/^[A-Z]{2}\d{2}[A-Z0-9*]{4,30}$/.test(r.ibanMasked.replace(/\s/g, ""))) return { id: "", status: "rejected", provider: this.name, simulated: true, message: "Check the IBAN" };
    return {
      id: `mock_payout_${Date.now()}`,
      status: "accepted",
      provider: this.name,
      simulated: true,
      message: "Simulated: on testnet no money is sent. A licensed partner would pay this to the IBAN after receiving the USDC.",
    };
  }

  async handleWebhook(): Promise<{ ok: boolean }> {
    return { ok: true };
  }
}

/**
 * Skeleton for a licensed provider (e.g. a regulated EUR on/off-ramp offering iDEAL, cards
 * and SEPA payouts). Fill in the provider's API: create a checkout session for top-ups,
 * deliver USDC with `ft_transfer_call(registry, msg {"top_up_for": {account_id}})`, and for
 * payouts receive USDC to the provider's NEAR account and send SEPA. Webhooks must be
 * HMAC-verified with the provider's secret (env RAMP_WEBHOOK_SECRET).
 */
export class LicensedRampProvider implements RampProvider {
  name = "licensed provider (not configured)";
  async createTopUp(): Promise<TopUpResult> {
    throw new Error("No licensed ramp provider is configured. Testnet uses the mock provider.");
  }
  async createPayout(): Promise<PayoutResult> {
    throw new Error("No licensed ramp provider is configured. Testnet uses the mock provider.");
  }
  async handleWebhook(): Promise<{ ok: boolean }> {
    throw new Error("not configured");
  }
}

export function rampProvider(): RampProvider {
  return process.env.RAMP_PROVIDER === "licensed" ? new LicensedRampProvider() : new MockRampProvider();
}
