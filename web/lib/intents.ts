/**
 * NEAR Intents 1Click API (https://1click.chaindefuser.com, see docs.near-intents.org).
 * Intents runs on mainnet only, so CapFare requests DRY quotes exclusively: they show what
 * a payout in USDC would be worth in another asset/chain, and no funds ever move.
 */
export const ONECLICK = "https://1click.chaindefuser.com";
export const MAINNET_USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

export const DESTINATIONS = [
  { id: "nep141:usdt.tether-token.near", label: "USDT on NEAR" },
  { id: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near", label: "USDC on Arbitrum" },
  { id: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", label: "USDC on Base" },
  { id: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", label: "USDC on Solana" },
  { id: "nep141:btc.omft.near", label: "Bitcoin" },
  { id: "nep141:eth.omft.near", label: "ETH on Ethereum" },
] as const;

export interface DryQuote {
  amountIn: string;
  amountInFormatted: string;
  amountOut: string;
  amountOutFormatted: string;
  amountOutUsd: string;
  timeEstimate: number;
}

export async function dryQuote(amountUsdcMicro: string, destinationAsset: string, apiKey?: string): Promise<DryQuote> {
  if (!DESTINATIONS.some((d) => d.id === destinationAsset)) throw new Error("unsupported destination");
  const body = {
    dry: true,
    swapType: "EXACT_INPUT",
    slippageTolerance: 100,
    originAsset: MAINNET_USDC,
    depositType: "INTENTS",
    destinationAsset,
    amount: amountUsdcMicro,
    refundTo: "intents.near",
    refundType: "INTENTS",
    recipient: "intents.near",
    recipientType: "INTENTS",
    deadline: new Date(Date.now() + 30 * 60_000).toISOString(),
  };
  const r = await fetch(`${ONECLICK}/v0/quote`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(apiKey ? { "x-api-key": apiKey } : {}) },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const j = (await r.json()) as { quote?: DryQuote; message?: string };
  if (!r.ok || !j.quote) throw new Error(j.message ?? `1Click ${r.status}`);
  if ("depositAddress" in j.quote) throw new Error("refusing a non-dry quote");
  return j.quote;
}
