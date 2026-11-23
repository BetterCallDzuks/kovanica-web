/**
 * What’s New — data for the marketing Landing only (apex).
 * Links point at public hosts (docs / testnet), never relative protocol paths
 * that would make apex look like a testnet clone.
 */

export type WhatsNewItem = {
  date: string;
  title: string;
  body: string;
  tag: "Protocol" | "Wallet" | "Infra" | "DeFi" | "Docs";
  href?: string;
};

const TESTNET = "https://testnet.kovanica.online";
const DOCS = "https://docs.kovanica.online";

export const WHATS_NEW: readonly WhatsNewItem[] = [
  {
    date: "2026-11",
    title: "Explorer Inspector, Miner Builder & Live Telemetry",
    body: "Shipped inline TxCard Bincode decoding with inspector deep-links, offline universal Transfer+Call raw wire tx decoding, PRO-21 address checksum & raw payload inspection, Contract Event Log Timeline, LiveDagDrawer Fee Pressure pill, Diagnostics RPC Latency Sparkline & Sync-Lag badge, and a collapsible KovanicaHash Miner & Stratum TLS Command Builder.",
    tag: "Infra",
    href: `${TESTNET}/explorer`,
  },
  {
    date: "2026-11",
    title: "Ecosystem Surfaces, Identity Headers & Pre-Flight Guards",
    body: "Updated /faucet with a PRO-21 pre-flight guard (2-24cdb5fadd98b207), /network with canonical identities & readiness strip (1-f35df34c92001436 / 2-24cdb5fadd98b207), /pool with Stratum TLS & frozen emission specs, and /api-reference with X-Kovanica-Chain-Id, X-Kovanica-Network-Tag, X-Kovanica-Rpc-Version headers and kovanica_mempoolStats.",
    tag: "Docs",
    href: `${TESTNET}/network`,
  },
  {
    date: "2026-11",
    title: "SDK v0.5.0 & L1 CLI Operational Tooling",
    body: "Released kovanica-sdk v0.5.0 alongside expanded L1 CLI operator and diagnostics commands: node doctor, rpc probe, snapshot verify, address inspect, tx decode, and tx envelope.",
    tag: "Protocol",
    href: DOCS,
  },
  {
    date: "2026-10",
    title: "kovanica-testnet (chain ID 2) live",
    body: "Hybrid PoW + GHOSTDAG consensus (target block 4 s, GHOSTDAG k=5, KovanicaHash PoW). There is no stake in consensus. Live node tag v0.3.0-node (e3fce499). The testnet faucet is open at /faucet. Deterministic Wasmi runtime and native KVNC. Mainnet launch 1.1.2027.",
    tag: "Protocol",
    href: `${TESTNET}/explorer`,
  },
  {
    date: "2026-10",
    title: "Tokenomics confirmed",
    body: "90.2M total supply (9 decimals), 82M subsidy budget, 8M linear treasury, 0 genesis allocation, 0.2M founder premine, and 2.5 KVNC initial block reward minted to committed block authors.",
    tag: "Protocol",
    href: DOCS,
  },
  {
    date: "2026-10",
    title: "Smart contracts & Wasmi",
    body: "Deterministic WASM smart contracts: HTLC atomic swaps, CLTV/CSV vaults, M-of-N Multisig, and KVP-102 native tokens.",
    tag: "Wallet",
    href: `${TESTNET}/multisig`,
  },
  {
    date: "2026-10",
    title: "Domain & Node Ingress",
    body: "Clean host routing across kovanica.online, testnet, explorer, and seed RPC nodes with automated Let's Encrypt SSL and high-performance Nginx reverse proxy.",
    tag: "Infra",
    href: `${TESTNET}/network`,
  },
  {
    date: "2026-10",
    title: "kovanica-testnet Hybrid PoW & KovanicaHash",
    body: "PoW block admission with BLAKE3 + 2 MiB memory mix (KovanicaHash, audit required before mainnet) and GHOSTDAG DAG ordering with 4 s target block interval.",
    tag: "Protocol",
    href: DOCS,
  },
  {
    date: "1.1.2027",
    title: "Public Launch Planned",
    body: "Public launch scheduled for 1.1.2027 following hybrid testnet milestones and security audits; 8,200,000-block × 3/4 decay eras.",
    tag: "Protocol",
    href: DOCS,
  },
] as const;
