/**
 * Published domain map (02-RedesignDomains).
 *
 * kovanica.online is the pure landing; the app surfaces live under the
 * network-scoped hosts. docs/playground/dash are their own surfaces;
 * mainnet.kovanica.online is the pre-launch preview gate ("Mainnet (Launching)").
 */
export const SURFACE = {
  landing: "https://kovanica.online",
  testnet: "https://testnet.kovanica.online",
  mainnet: "https://mainnet.kovanica.online",
  dash: "https://dash.kovanica.online",
  api: "https://testnet.kovanica.online/api-reference",
  docs: "https://docs.kovanica.online",
  playground: "https://playground.kovanica.online",
  explorer: "https://testnet.kovanica.online/explorer",
  wallet: "https://testnet.kovanica.online/wallet",
  pool: "https://testnet.kovanica.online/pool",
  pools: "https://testnet.kovanica.online/pools",
  rpcTestnet: "https://rpc-testnet.kovanica.online/rpc",
  github: "https://github.com/BetterCallDzuks",
} as const;

export const SURFACE_STATUS = {
  mainnet: "Mainnet (Launching)",
} as const;
