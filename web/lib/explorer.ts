/** Links to the public block explorer (NearBlocks on testnet; none on a local sandbox). Client-safe. */
export function explorer(): string | undefined {
  if (typeof document === "undefined") return undefined;
  return document.documentElement.dataset.explorer || undefined;
}
export const txUrl = (hash: string) => (explorer() ? `${explorer()}/txns/${hash}` : undefined);
export const accountUrl = (id: string) => (explorer() ? `${explorer()}/address/${id}` : undefined);

/** Every confirmed gasless transaction is announced so the app can link it (components/app/TxNotice.tsx). */
export const TX_EVENT = "capfare:tx";
export interface TxEventDetail {
  hash: string;
  method: string;
  receiver: string;
}
