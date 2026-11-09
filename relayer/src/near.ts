import { deserialize } from "borsh";
import { Account, actions, JsonRpcProvider, KeyPairSigner, SCHEMA, teraToGas, type SignedDelegate } from "near-api-js";
import type { DelegateView, FnCall } from "./policy.ts";

export function decodeSignedDelegate(b64: string): SignedDelegate {
  const bytes = Buffer.from(b64, "base64");
  return deserialize(SCHEMA.SignedDelegate, bytes) as unknown as SignedDelegate;
}

/** Normalises a decoded delegate into the shape the policy checks. */
export function viewDelegate(sd: SignedDelegate): DelegateView {
  const da = sd.delegateAction as unknown as { senderId: string; receiverId: string; actions: any[] };
  const calls: FnCall[] = [];
  for (const a of da.actions) {
    const fc = a.functionCall;
    if (!fc) return { senderId: da.senderId, receiverId: da.receiverId, calls: null };
    calls.push({ methodName: fc.methodName, args: Uint8Array.from(fc.args), gas: BigInt(fc.gas), deposit: BigInt(fc.deposit) });
  }
  return { senderId: da.senderId, receiverId: da.receiverId, calls };
}

export interface ChainOps {
  relay(sd: SignedDelegate): Promise<{ hash: string; ok: boolean; error?: string }>;
  createUser(accountId: string, publicKey: string, nearYocto: bigint): Promise<void>;
  registerOnToken(token: string, accountId: string): Promise<void>;
  submitSnapshots(attestation: string, snapshots: unknown[]): Promise<string[]>;
}

function outcome(r: any): { hash: string; ok: boolean; error?: string } {
  const st = r?.status ?? r?.final_execution_status;
  const failure = st && typeof st === "object" && "Failure" in st ? JSON.stringify(st.Failure) : undefined;
  return { hash: r?.transaction?.hash ?? r?.transaction_outcome?.id ?? "", ok: !failure, error: failure };
}

export function nearChain(rpcUrl: string, relayerId: string, secretKey: string): ChainOps {
  const provider = new JsonRpcProvider({ url: rpcUrl });
  const relayer = new Account(relayerId, provider, KeyPairSigner.fromSecretKey(secretKey as never));
  return {
    async relay(sd) {
      return outcome(await relayer.relayMetaTransaction(sd));
    },
    async createUser(accountId, publicKey, nearYocto) {
      const prefix = accountId.slice(0, -(relayerId.length + 1));
      await relayer.createSubAccount({ accountOrPrefix: prefix, publicKey, nearToTransfer: nearYocto });
    },
    async registerOnToken(token, accountId) {
      await relayer.signAndSendTransaction({
        receiverId: token,
        actions: [actions.functionCall("storage_deposit", { account_id: accountId, registration_only: true }, teraToGas(30), 12_500_000_000_000_000_000_000n)],
      });
    },
    async submitSnapshots(attestation, snapshots) {
      const r: any = await relayer.signAndSendTransaction({
        receiverId: attestation,
        actions: [actions.functionCall("submit_snapshots", { snapshots }, teraToGas(300), 0n)],
      });
      const v = r?.status?.SuccessValue;
      return v ? JSON.parse(Buffer.from(v, "base64").toString()) : [];
    },
  };
}
