/** Server-side configuration (env). Never import from client components. */
export interface ServerConfig {
  network: "testnet" | "sandbox";
  rpcUrl: string;
  registry: string;
  attestation: string;
  capVault: string;
  dropVault: string;
  token: string;
  oracleUrl?: string;
  verifierUrl?: string;
  relayerUrl?: string;
  notifierUrl?: string;
  rampAccountId?: string;
  rampPrivateKey?: string;
  demo: boolean;
  oneClickApiKey?: string;
  siteUrl: string;
  /** Public address of the Skyline Travel demo booking site when it has its own domain (demo only). */
  skylineUrl?: string;
  extensionUrl?: string;
  githubUrl: string;
  xUrl?: string;
}

export function serverConfig(): ServerConfig {
  const e = process.env;
  const network = (e.CAPFARE_NETWORK ?? "testnet") as ServerConfig["network"];
  if (network !== "testnet" && network !== "sandbox") throw new Error("CapFare web runs against testnet or sandbox only");
  return {
    network,
    rpcUrl: e.NEAR_RPC_URL ?? "https://test.rpc.fastnear.com",
    registry: e.REGISTRY_ID ?? "",
    attestation: e.ATTESTATION_ID ?? "",
    capVault: e.CAP_VAULT_ID ?? "",
    dropVault: e.DROP_VAULT_ID ?? "",
    token: e.TOKEN_ID ?? "",
    oracleUrl: e.ORACLE_URL,
    verifierUrl: e.VERIFIER_URL,
    relayerUrl: e.RELAYER_URL,
    notifierUrl: e.NOTIFIER_URL,
    rampAccountId: e.RAMP_ACCOUNT_ID,
    rampPrivateKey: e.RAMP_PRIVATE_KEY,
    demo: e.CAPFARE_DEMO === "true",
    oneClickApiKey: e.ONECLICK_API_KEY,
    siteUrl: e.SITE_URL ?? "http://localhost:3000",
    skylineUrl: e.SKYLINE_URL?.replace(/\/$/, "") || undefined,
    extensionUrl: e.EXTENSION_URL,
    githubUrl: e.GITHUB_URL ?? "https://github.com/thomasdevving/capfare",
    xUrl: e.X_URL,
  };
}

export function configured(c: ServerConfig = serverConfig()): boolean {
  return Boolean(c.registry && c.capVault && c.dropVault && c.attestation);
}

export function networkLabel(n: ServerConfig["network"]): string {
  return n === "sandbox" ? "Local sandbox" : "NEAR testnet";
}

/** Public block explorer for the network (none for a local sandbox). */
export function explorerUrl(n: ServerConfig["network"]): string | undefined {
  return n === "testnet" ? process.env.EXPLORER_URL ?? "https://testnet.nearblocks.io" : undefined;
}
