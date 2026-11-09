/** A CapFare end user: named account created by the relayer, gasless via NEP-366. */
import { Account, actions, encodeSignedDelegate, JsonRpcProvider, KeyPair, KeyPairSigner, teraToGas, type KeyPairString } from "near-api-js";

export class GaslessUser {
  readonly account: Account;
  constructor(readonly accountId: string, key: KeyPairString, rpcUrl: string, private relayerUrl: string) {
    this.account = new Account(accountId, new JsonRpcProvider({ url: rpcUrl }), KeyPairSigner.fromSecretKey(key));
  }

  static async create(name: string, rpcUrl: string, relayerUrl: string): Promise<GaslessUser> {
    const kp = KeyPair.fromRandom("ed25519");
    const r = await fetch(`${relayerUrl}/v1/accounts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, public_key: kp.getPublicKey().toString() }),
    });
    const j = (await r.json()) as { account_id?: string; error?: string };
    if (!r.ok) throw new Error(`account creation failed: ${j.error}`);
    return new GaslessUser(j.account_id!, kp.toString() as KeyPairString, rpcUrl, relayerUrl);
  }

  /** Signs a delegate action locally and asks the relayer to submit it (relayer pays gas). */
  async call(receiverId: string, method: string, args: Record<string, unknown>, deposit = 0n, tgas = 300): Promise<{ tx_hash: string; ok: boolean; error?: string; receipt_failures?: string[]; events?: { event: string; data: any }[] }> {
    const { signedDelegate } = await this.account.createSignedMetaTransaction({
      receiverId,
      actions: [actions.functionCall(method, args, teraToGas(tgas), deposit)],
      blockHeightTtl: 120,
    } as never);
    const r = await fetch(`${this.relayerUrl}/v1/relay`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signed_delegate: Buffer.from(encodeSignedDelegate(signedDelegate)).toString("base64") }),
    });
    const j = (await r.json()) as { tx_hash: string; ok: boolean; error?: string; receipt_failures?: string[]; events?: { event: string; data: any }[] };
    if (j.receipt_failures?.length && process.env.DEBUG_RELAY) console.log(`    [relay] ${method} receipt failures:`, j.receipt_failures);
    if (!r.ok) throw new Error(`relayer refused ${method}: ${(j as { error?: string }).error}`);
    const failed = (j.events ?? []).find((e) => /failed|rejected/.test(e.event));
    if (failed) throw new Error(`${method}: ${failed.event} ${JSON.stringify(failed.data)}`);
    if (!j.ok) throw new Error(`${method} failed on-chain: ${j.error}`);
    return j;
  }
}
