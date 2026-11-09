/** Thin near-api-js wrapper used by deploy/demo scripts (sandbox and testnet). */
import { readFileSync } from "node:fs";
import { Account, actions, JsonRpcProvider, KeyPair, KeyPairSigner, teraToGas, type KeyPairString } from "near-api-js";

export const NEAR = 10n ** 24n;

export class Chain {
  readonly provider: JsonRpcProvider;
  private accounts = new Map<string, Account>();

  constructor(readonly rpcUrl: string, readonly network: "sandbox" | "testnet") {
    if (network !== "sandbox" && network !== "testnet") throw new Error("CapFare scripts run on sandbox or testnet only");
    this.provider = new JsonRpcProvider({ url: rpcUrl });
  }

  account(id: string, key?: KeyPairString): Account {
    if (key) this.accounts.set(id, new Account(id, this.provider, KeyPairSigner.fromSecretKey(key)));
    const a = this.accounts.get(id);
    if (!a) throw new Error(`no key for ${id}`);
    return a;
  }

  async exists(id: string): Promise<boolean> {
    try {
      await this.provider.viewAccount({ accountId: id } as never);
      return true;
    } catch {
      return false;
    }
  }

  async createSub(parent: string, prefix: string, near: bigint, key: KeyPairString): Promise<string> {
    const id = `${prefix}.${parent}`;
    if (!(await this.exists(id))) {
      const kp = KeyPair.fromString(key);
      await this.account(parent).createSubAccount({ accountOrPrefix: prefix, publicKey: kp.getPublicKey().toString(), nearToTransfer: near });
    }
    this.account(id, key);
    return id;
  }

  async deploy(id: string, wasmPath: string, init: Record<string, unknown>): Promise<void> {
    const code = readFileSync(wasmPath);
    await this.account(id).signAndSendTransaction({
      receiverId: id,
      actions: [actions.deployContract(code), actions.functionCall("new", init, teraToGas(100), 0n)],
    });
  }

  async call<T = unknown>(signer: string, contract: string, method: string, args: Record<string, unknown> = {}, deposit = 0n, tgas = 300): Promise<T> {
    const r: any = await this.account(signer).signAndSendTransaction({
      receiverId: contract,
      actions: [actions.functionCall(method, args, teraToGas(tgas), deposit)],
      throwOnFailure: true,
    } as never);
    const v = r?.status?.SuccessValue;
    if (!v) return undefined as T;
    const s = Buffer.from(v, "base64").toString();
    try {
      return JSON.parse(s) as T;
    } catch {
      return s as T;
    }
  }

  async view<T>(contract: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
    const r: any = await this.provider.callFunctionRaw({ contractId: contract, method, args } as never);
    return JSON.parse(Buffer.from(r.result).toString()) as T;
  }

  async nowSecs(): Promise<number> {
    const b: any = await this.provider.viewBlock({ finality: "final" } as never);
    return Math.floor(Number(BigInt(b.header.timestamp_nanosec) / 1_000_000_000n));
  }
}

export function newKey(): KeyPairString {
  return KeyPair.fromRandom("ed25519").toString() as KeyPairString;
}
