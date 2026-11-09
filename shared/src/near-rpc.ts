/** Minimal read-only NEAR JSON-RPC client (view calls, block time). No keys involved. */
export interface RpcOptions {
  rpcUrl: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class NearViewClient {
  constructor(private opts: RpcOptions) {}

  private async rpc<T>(method: string, params: unknown): Promise<T> {
    const f = this.opts.fetchImpl ?? fetch;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 8000);
    try {
      const res = await f(this.opts.rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "capfare", method, params }),
        signal: ctrl.signal,
      });
      const j = (await res.json()) as { result?: T & { error?: string }; error?: { message?: string; data?: unknown } };
      if (j.error) throw new Error(`rpc error: ${JSON.stringify(j.error)}`);
      if (j.result && typeof j.result === "object" && "error" in j.result && j.result.error) throw new Error(String(j.result.error));
      return j.result as T;
    } finally {
      clearTimeout(t);
    }
  }

  async view<T>(contractId: string, method: string, args: unknown = {}): Promise<T> {
    const argsB64 = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(args))));
    const r = await this.rpc<{ result: number[] }>("query", {
      request_type: "call_function",
      finality: "final",
      account_id: contractId,
      method_name: method,
      args_base64: argsB64,
    });
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(r.result))) as T;
  }

  /** True if `publicKey` ("ed25519:<base58>") is an access key of `accountId`. */
  async hasAccessKey(accountId: string, publicKey: string): Promise<boolean> {
    try {
      await this.rpc("query", { request_type: "view_access_key", finality: "final", account_id: accountId, public_key: publicKey });
      return true;
    } catch {
      return false;
    }
  }

  async blockTimeSecs(): Promise<number> {
    const r = await this.rpc<{ header: { timestamp_nanosec: string } }>("block", { finality: "final" });
    return Math.floor(Number(BigInt(r.header.timestamp_nanosec) / 1_000_000_000n));
  }
}
