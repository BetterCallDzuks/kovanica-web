/**
 * Kovanica Ecosystem Monetization & Services Config (zero tracking cookies).
 *
 * Centralizes all 6 non-token revenue streams:
 * 1. Managed RPC, WebSocket & Indexer API tiers
 * 2. RWA Issuer & Compliance SaaS
 * 3. Configurable front-end Swap/Bridge interface fee (0% default on testnet)
 * 4. Official Stratum V1 TLS Mining Pool fee disclosure
 * 5. Verified Listings & Privacy-First Sponsorships / Partner referrals (off until configured)
 * 6. Exchange & Enterprise Integration Support
 */

export type InquiryTopic =
  | "rpc"
  | "rwa"
  | "listing"
  | "sponsorship"
  | "enterprise"
  | "pool";

export const INQUIRY_TOPIC_LABELS: Record<InquiryTopic, string> = {
  rpc: "Managed RPC & Indexer API",
  rwa: "RWA Issuer & Compliance SaaS",
  listing: "Verified Token / RWA Listing",
  sponsorship: "Privacy-First Surface Sponsorship",
  enterprise: "Exchange & Enterprise Support",
  pool: "Official Mining Pool / Institutional Hashrate",
};

export interface PricingTier {
  id: string;
  name: string;
  price: string;
  cadence: string;
  badge?: string;
  description: string;
  features: readonly string[];
  ctaLabel: string;
  topic: InquiryTopic;
}

export const RPC_TIERS: readonly PricingTier[] = [
  {
    id: "rpc-free",
    name: "Public Testnet",
    price: "$0",
    cadence: "forever",
    description: "Shared public JSON-RPC for development, testing, and wallets.",
    features: [
      "Shared rate-limited HTTP JSON-RPC",
      "Public BlockDAG Explorer & Faucet",
      "Full Wave A–D RPC method surface",
      "Community GitHub & Docs support",
    ],
    ctaLabel: "Use Public RPC",
    topic: "rpc",
  },
  {
    id: "rpc-builder",
    name: "Builder",
    price: "$49",
    cadence: "/ month",
    badge: "Popular",
    description: "Dedicated API key for dApps, bots, and production wallets.",
    features: [
      "Dedicated API key · up to 100 req/s",
      "Persistent WebSocket push streams",
      "UTXO & KVP-102/106 indexer queries",
      "Priority email & Discord support",
    ],
    ctaLabel: "Request Builder Key",
    topic: "rpc",
  },
  {
    id: "rpc-scale",
    name: "Scale",
    price: "$249",
    cadence: "/ month",
    description: "High-throughput archive access for exchanges, analytics, and DEXs.",
    features: [
      "Up to 500 req/s burst capacity",
      "Full archive history & receipt lookups",
      "Webhook alerts for addresses & contracts",
      "99.5% uptime target & priority triage",
    ],
    ctaLabel: "Request Scale Key",
    topic: "rpc",
  },
  {
    id: "rpc-dedicated",
    name: "Dedicated Cluster",
    price: "Custom",
    cadence: "SLA",
    description: "Isolated Kovanica L1 nodes and indexers managed for your stack.",
    features: [
      "Dedicated multi-region L1 + indexer nodes",
      "Custom rate limits & private peering",
      "99.9% SLA with 24/7 incident escalation",
      "Direct engineering Slack/Telegram channel",
    ],
    ctaLabel: "Contact Enterprise",
    topic: "enterprise",
  },
] as const;

export const RWA_PLANS: readonly PricingTier[] = [
  {
    id: "rwa-launch",
    name: "Issuer Launch",
    price: "$299",
    cadence: "/ month",
    description: "Self-serve KVP-106 issuance and allowlist operations for a single issuer.",
    features: [
      "Guided KVP-106 deterministic asset derivation",
      "Allowlist & transfer-restriction management",
      "Public /rwa Registry listing & Explorer badge",
      "Standard compliance audit CSV exports",
    ],
    ctaLabel: "Start Issuer Onboarding",
    topic: "rwa",
  },
  {
    id: "rwa-institutional",
    name: "Institutional Compliance",
    price: "$999",
    cadence: "/ month",
    badge: "B2B",
    description: "Full lifecycle compliance console for regulated funds, bonds, and real estate.",
    features: [
      "Multi-asset issuer workspace & role controls",
      "Automated coupon & dividend scheduler hooks",
      "Freeze / forced-transfer governance workflows",
      "Dedicated compliance integration & SLA",
    ],
    ctaLabel: "Request Institutional Demo",
    topic: "rwa",
  },
  {
    id: "rwa-whitelabel",
    name: "White-Label Portal",
    price: "Custom",
    cadence: "annual",
    description: "Branded investor portal & custody integration on your own domain.",
    features: [
      "Custom domain, branding & KYC provider hooks",
      "Hardware multisig & custodian sign-off flows",
      "Dedicated Kovanica indexer & audit logging",
      "Joint go-to-market & legal-tech coordination",
    ],
    ctaLabel: "Discuss White-Label",
    topic: "rwa",
  },
] as const;

export const LISTING_AND_SPONSOR_OFFERS: readonly PricingTier[] = [
  {
    id: "verified-token",
    name: "Verified Token Listing",
    price: "$250",
    cadence: "one-time",
    description: "Manual metadata, logo, and contract verification across Kovanica Web & Wallet.",
    features: [
      "Verified badge on /wallet/token-listings & /swap",
      "Canonical metadata & icon hosting review",
      "Anti-impersonation & contract-hash verification",
      "Fast-track 48-hour review turnaround",
    ],
    ctaLabel: "Request Token Verification",
    topic: "listing",
  },
  {
    id: "verified-rwa",
    name: "Verified RWA Issuer Badge",
    price: "$500",
    cadence: "one-time",
    description: "Public issuer attestation and featured placement in the /rwa Registry.",
    features: [
      "Verified Issuer badge on /rwa & /explorer/rwa",
      "Signed issuer domain & legal-entity link check",
      "Dedicated asset detail metadata review",
      "Priority listing update support",
    ],
    ctaLabel: "Apply for Issuer Badge",
    topic: "listing",
  },
  {
    id: "surface-sponsor",
    name: "Privacy-First Sponsorship",
    price: "$400",
    cadence: "/ month",
    badge: "Zero Cookies",
    description: "Static, non-tracking sponsor banner on Explorer, Faucet, or Docs.",
    features: [
      "Zero third-party ad scripts or tracking cookies",
      "Fixed monthly flat rate (no auction volatility)",
      "Reaches builders, miners, and Kovanica holders",
      "Hardware wallets, audits, hosting & infra welcome",
    ],
    ctaLabel: "Book Sponsor Slot",
    topic: "sponsorship",
  },
] as const;

export const ENTERPRISE_OFFERS = [
  {
    title: "Exchange & Custodian Integration",
    price: "From $2,500",
    desc: "End-to-end node deployment, PRO-21 deposit/withdrawal indexing, hot/cold wallet review, and launch-day engineering support.",
  },
  {
    title: "Custom Indexer & Analytics Pipeline",
    price: "From $1,500",
    desc: "Tailored KVP-102/KVP-106 event pipelines, PostgreSQL/ClickHouse syncers, and real-time webhook infrastructure.",
  },
  {
    title: "SDK & Smart Contract Advisory",
    price: "Retainer / Fixed",
    desc: "Hands-on Wasmi contract reviews, `kovanica-sdk` integration sprints, and Wave A–D batch transaction architecture.",
  },
] as const;

export interface SwapInterfaceFeeConfig {
  /** Basis points (0..100 => 0.00%..1.00%). Defaults to 0 on testnet. */
  feeBps: number;
  /** Optional recipient address for mainnet interface fee routing. */
  recipient: string | null;
  /** True when feeBps > 0. */
  active: boolean;
}

export interface MiningPoolFeeConfig {
  testnetFeePct: number;
  plannedMainnetFeePct: number;
}

export interface SponsorCreative {
  label: string;
  text: string;
  url: string;
  cta: string;
}

export interface PartnerLink {
  id: string;
  category: "Hardware Wallet" | "Mining & VPS Hosting";
  label: string;
  description: string;
  url: string;
}

function readEnv(key: string): string | undefined {
  // Support both Vite client `import.meta.env` and Node/SSR `process.env`
  const metaEnv =
    typeof import.meta !== "undefined"
      ? (import.meta as unknown as { env?: Record<string, string | undefined> }).env
      : undefined;
  const val = metaEnv?.[key] ?? (typeof process !== "undefined" ? process.env?.[key] : undefined);
  return typeof val === "string" && val.trim().length > 0 ? val.trim() : undefined;
}

/** Strictly accepts only https:// URLs to prevent javascript: or insecure links. */
export function sanitizeHttpsUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const parsed = new URL(raw.trim());
    if (parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function getSwapInterfaceFeeConfig(
  overrides?: { feeBps?: string; recipient?: string },
): SwapInterfaceFeeConfig {
  const rawBps = overrides?.feeBps ?? readEnv("VITE_SWAP_INTERFACE_FEE_BPS");
  const parsed = rawBps !== undefined ? Number(rawBps) : 0;
  const clamped =
    Number.isFinite(parsed) && parsed > 0 ? Math.min(100, Math.round(parsed)) : 0;
  const recipient = (overrides?.recipient ?? readEnv("VITE_SWAP_FEE_RECIPIENT")) || null;
  return {
    feeBps: clamped,
    recipient,
    active: clamped > 0,
  };
}

export function computeSwapInterfaceFee(amountInRaw: bigint, feeBps: number): bigint {
  if (amountInRaw <= 0n || !Number.isFinite(feeBps) || feeBps <= 0) return 0n;
  const clamped = BigInt(Math.min(100, Math.round(feeBps)));
  return (amountInRaw * clamped) / 10_000n;
}

export function getMiningPoolFeeConfig(
  overrides?: { plannedMainnetFeePct?: string },
): MiningPoolFeeConfig {
  const raw = overrides?.plannedMainnetFeePct ?? readEnv("VITE_MINING_POOL_FEE_PCT");
  const parsed = raw !== undefined ? Number(raw) : 1.0;
  const plannedMainnetFeePct =
    Number.isFinite(parsed) && parsed >= 0 && parsed <= 5 ? parsed : 1.0;
  return {
    testnetFeePct: 0,
    plannedMainnetFeePct,
  };
}

export function getSponsorConfig(overrides?: {
  label?: string;
  text?: string;
  url?: string;
  cta?: string;
}): SponsorCreative | null {
  const url = sanitizeHttpsUrl(overrides?.url ?? readEnv("VITE_SPONSOR_URL"));
  const text = (overrides?.text ?? readEnv("VITE_SPONSOR_TEXT"))?.trim();
  if (!url || !text) return null;
  return {
    label: (overrides?.label ?? readEnv("VITE_SPONSOR_LABEL"))?.trim() || "Sponsored",
    text,
    url,
    cta: (overrides?.cta ?? readEnv("VITE_SPONSOR_CTA"))?.trim() || "Learn more",
  };
}

export function getPartnerLinks(overrides?: {
  hardwareUrl?: string;
  vpsUrl?: string;
}): PartnerLink[] {
  const links: PartnerLink[] = [];
  const hwUrl = sanitizeHttpsUrl(overrides?.hardwareUrl ?? readEnv("VITE_PARTNER_HARDWARE_URL"));
  if (hwUrl) {
    links.push({
      id: "hardware-wallet",
      category: "Hardware Wallet",
      label: "Recommended Hardware Wallet",
      description: "Sign Kovanica transactions offline with hardware-backed custody.",
      url: hwUrl,
    });
  }
  const vpsUrl = sanitizeHttpsUrl(overrides?.vpsUrl ?? readEnv("VITE_PARTNER_VPS_URL"));
  if (vpsUrl) {
    links.push({
      id: "vps-hosting",
      category: "Mining & VPS Hosting",
      label: "Recommended Node & Pool VPS",
      description: "Low-latency Linux servers for running Kovanica nodes, indexers, and Stratum pools.",
      url: vpsUrl,
    });
  }
  return links;
}
