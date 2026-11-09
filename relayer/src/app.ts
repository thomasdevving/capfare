import { NearViewClient, verifySnapshot, type SignedSnapshot } from "@capfare/shared";
import { HttpError, type Handler } from "@capfare/tee-common";
import { checkDelegate, Quota, validSubName, type RelayConfig } from "./policy.ts";
import { decodeSignedDelegate, viewDelegate, type ChainOps } from "./near.ts";

export interface AppConfig extends RelayConfig {
  relayerId: string;
  attestation: string;
  newAccountNearYocto: bigint;
}

export function routes(cfg: AppConfig, chain: ChainOps, view?: NearViewClient): Record<string, Handler> {
  const perAccountHour = new Quota(40, 3_600_000);
  const perAccountDay = new Quota(200, 86_400_000);
  const perIpHour = new Quota(120, 3_600_000);
  const accountsPerIpDay = new Quota(5, 86_400_000);
  const snapshotsPerMin = new Quota(30, 60_000);
  let signers: { at: number; keys: Set<string> } = { at: 0, keys: new Set() };

  async function oracleSigners(): Promise<Set<string>> {
    if (!view || Date.now() - signers.at < 60_000) return signers.keys;
    const ks = await view.view<[string, { service: string; revoked: boolean }][]>(cfg.attestation, "get_keys", {});
    signers = { at: Date.now(), keys: new Set(ks.filter(([, k]) => k.service === "price_oracle" && !k.revoked).map(([pk]) => pk)) };
    return signers.keys;
  }

  const ip = (req: any) => String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "?").split(",")[0].trim();

  return {
    "GET /health": () => ({ ok: true, relayer: cfg.relayerId, sponsored: [cfg.registry, cfg.capVault, cfg.dropVault, cfg.token] }),

    "POST /v1/relay": async (body: { signed_delegate: string }, req) => {
      if (!perIpHour.hit(ip(req))) throw new HttpError(429, "too many requests from this address");
      let sd;
      try {
        sd = decodeSignedDelegate(body.signed_delegate);
      } catch {
        throw new HttpError(400, "invalid signed delegate");
      }
      const d = viewDelegate(sd);
      const err = checkDelegate(d, cfg);
      if (err) throw new HttpError(403, err);
      if (!perAccountHour.hit(d.senderId) || !perAccountDay.hit(d.senderId)) throw new HttpError(429, "too many transactions for this account; try later");
      const r = await chain.relay(sd);
      return { tx_hash: r.hash, ok: r.ok, error: r.error };
    },

    "POST /v1/accounts": async (body: { name: string; public_key: string }, req) => {
      const name = String(body.name ?? "").toLowerCase();
      if (!validSubName(name)) throw new HttpError(400, "names use 3–32 lowercase letters, digits, - or _");
      if (!/^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(String(body.public_key))) throw new HttpError(400, "invalid public key");
      if (!accountsPerIpDay.hit(ip(req))) throw new HttpError(429, "too many new accounts from this address today");
      const accountId = `${name}.${cfg.relayerId}`;
      try {
        await chain.createUser(accountId, body.public_key, cfg.newAccountNearYocto);
      } catch (e) {
        const m = String(e);
        if (/already exists|AccountAlreadyExists/i.test(m)) throw new HttpError(409, "this name is taken");
        throw e;
      }
      await chain.registerOnToken(cfg.token, accountId);
      return { account_id: accountId };
    },

    "POST /v1/snapshots": async (body: { snapshots: SignedSnapshot[] }) => {
      if (!snapshotsPerMin.hit("global")) throw new HttpError(429, "slow down");
      const list = Array.isArray(body.snapshots) ? body.snapshots.slice(0, 50) : [];
      if (!list.length) throw new HttpError(400, "no snapshots");
      const allowed = await oracleSigners();
      const good = list.filter((s) => verifySnapshot(s) && (!view || allowed.has(s.signer)));
      if (!good.length) throw new HttpError(403, "no snapshot is signed by a registered oracle key");
      const results = await chain.submitSnapshots(cfg.attestation, good);
      return { results, rejected_before_submit: list.length - good.length };
    },
  };
}
