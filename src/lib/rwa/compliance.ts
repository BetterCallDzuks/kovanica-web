/**
 * Institutional RWA (KVP-106) Compliance, Registry & Scheduled Dividend Helpers
 * for Kovanica Web (`/rwa` and `/wallet/rwa-manage`).
 */

export type RwaAssetClass = "RE" | "BOND" | "INVOICE" | "COMMODITY" | "FUND" | "OTHER";

export interface RwaRegistryEntry {
  assetId: string;
  contractAddress: string;
  name: string;
  symbol: string;
  assetClass: RwaAssetClass;
  jurisdiction: string;
  issuerAddress: string;
  decimals: number;
  totalSupply: string;
  maxSupply: string;
  paused: boolean;
  complianceStatus: "COMPLIANT" | "PAUSED";
  holderCount: number;
  frozenCount: number;
  allowlistedCount: number;
  couponAprPct?: number;
  legalUri: string;
  custodyUri: string;
}

export interface RwaHolderRow {
  address: string;
  balance: bigint;
  allowlisted: boolean;
  kycTier: number;
  frozen: boolean;
}

export const MAX_WAVE_A_BATCH_ACTIONS = 16;

export const DEFAULT_RWA_REGISTRY: readonly RwaRegistryEntry[] = [
  {
    assetId: "a1".repeat(32),
    contractAddress: "a1".repeat(32),
    name: "Kovanica US Treasury Bill 2027",
    symbol: "kUSTB27",
    assetClass: "BOND",
    jurisdiction: "US",
    issuerAddress: "kvnc11111111111111111111111111111111111111111111111111111111dag",
    decimals: 6,
    totalSupply: "12500000000000",
    maxSupply: "50000000000000",
    paused: false,
    complianceStatus: "COMPLIANT",
    holderCount: 142,
    frozenCount: 1,
    allowlistedCount: 218,
    couponAprPct: 4.85,
    legalUri: "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
    custodyUri: "ipfs://bafybeihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku",
  },
  {
    assetId: "b2".repeat(32),
    contractAddress: "b2".repeat(32),
    name: "Zurich Prime Commercial Real Estate Trust",
    symbol: "kZURRE",
    assetClass: "RE",
    jurisdiction: "CH",
    issuerAddress: "kvnc22222222222222222222222222222222222222222222222222222222dag",
    decimals: 6,
    totalSupply: "8400000000000",
    maxSupply: "10000000000000",
    paused: false,
    complianceStatus: "COMPLIANT",
    holderCount: 64,
    frozenCount: 0,
    allowlistedCount: 95,
    couponAprPct: 6.2,
    legalUri: "ipfs://bafybeiczsscdsbs7ffqz55asqdf3smv6klcw3gofszvwlyarci47bgf354",
    custodyUri: "ipfs://bafybeifx7yeb55armcsxwwitkymga5xf53dxiarykms3ygqic223w5sk3m",
  },
  {
    assetId: "c3".repeat(32),
    contractAddress: "c3".repeat(32),
    name: "EU Sovereign Green Bond Series A",
    symbol: "kEUGB28",
    assetClass: "BOND",
    jurisdiction: "DE",
    issuerAddress: "kvnc33333333333333333333333333333333333333333333333333333333dag",
    decimals: 6,
    totalSupply: "25000000000000",
    maxSupply: "25000000000000",
    paused: true,
    complianceStatus: "PAUSED",
    holderCount: 310,
    frozenCount: 2,
    allowlistedCount: 405,
    couponAprPct: 3.6,
    legalUri: "ipfs://bafybeiemxf5abjwjbikoz4mc3a3dla6ual3jsgpdr4cjr3oz3evfyavhwq",
    custodyUri: "ipfs://bafybeigvgzoolc3drupxhlevdp2ugqcrbcsqfmcek2zxiw5wctk3xjpjwy",
  },
  {
    assetId: "d4".repeat(32),
    contractAddress: "d4".repeat(32),
    name: "Allocated Vaulted Gold Reserve",
    symbol: "kXAU",
    assetClass: "COMMODITY",
    jurisdiction: "SG",
    issuerAddress: "kvnc44444444444444444444444444444444444444444444444444444444dag",
    decimals: 8,
    totalSupply: "420000000000",
    maxSupply: "0",
    paused: false,
    complianceStatus: "COMPLIANT",
    holderCount: 518,
    frozenCount: 0,
    allowlistedCount: 740,
    legalUri: "ipfs://bafybeibml5uieyxa5tufngvg7fgwbkwvlsuntwbxgtskoqynbt7wlchmfm",
    custodyUri: "ipfs://bafybeic56z3yccnla3jetlfq53h66762272626262626262626262626262626",
  },
];

/** Strict PRO-21 format check (`kvnc...dag` or `tkvnc...dag`). */
export function isPro21AddressFormat(addr: string): boolean {
  const trimmed = addr.trim();
  return /^(t?kvnc)[0-9a-zA-Z]{50,64}dag$/.test(trimmed);
}

/** Splits allowlist entries into Wave A atomic batches of at most 16 actions. */
export function chunkAllowlistEntries<T>(entries: readonly T[]): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < entries.length; i += MAX_WAVE_A_BATCH_ACTIONS) {
    batches.push(entries.slice(i, i + MAX_WAVE_A_BATCH_ACTIONS));
  }
  return batches;
}

/** Validates a mint operation against the RWA token's max supply cap (`0n` = uncapped). */
export function validateMintAgainstCap(
  currentSupply: bigint,
  maxSupply: bigint,
  mintAmount: bigint,
): { ok: true; nextSupply: bigint } | { ok: false; error: string } {
  if (mintAmount <= 0n) {
    return { ok: false, error: "Mint amount must be greater than zero" };
  }
  const nextSupply = currentSupply + mintAmount;
  if (maxSupply > 0n && nextSupply > maxSupply) {
    return {
      ok: false,
      error: `Exceeds max supply cap (${currentSupply.toString()} + ${mintAmount.toString()} > ${maxSupply.toString()})`,
    };
  }
  return { ok: true, nextSupply };
}

export interface ProRataPayoutRow {
  address: string;
  balance: bigint;
  sharePct: number;
  payoutAtoms: bigint;
}

/** Computes pro-rata coupon/dividend payouts for allowlisted, non-frozen holders. */
export function computeProRataCouponDistribution(
  totalPayoutAtoms: bigint,
  holders: readonly RwaHolderRow[],
): {
  eligibleHolders: ProRataPayoutRow[];
  totalDistributed: bigint;
  dustRemainder: bigint;
} {
  const eligible = holders.filter((h) => h.allowlisted && !h.frozen && h.balance > 0n);
  const totalBalance = eligible.reduce((acc, h) => acc + h.balance, 0n);
  if (totalPayoutAtoms <= 0n || totalBalance === 0n) {
    return { eligibleHolders: [], totalDistributed: 0n, dustRemainder: totalPayoutAtoms };
  }
  let totalDistributed = 0n;
  const rows: ProRataPayoutRow[] = eligible.map((h) => {
    const payoutAtoms = (totalPayoutAtoms * h.balance) / totalBalance;
    const sharePct = Number((h.balance * 10_000n) / totalBalance) / 100;
    totalDistributed += payoutAtoms;
    return {
      address: h.address,
      balance: h.balance,
      sharePct,
      payoutAtoms,
    };
  });
  return {
    eligibleHolders: rows,
    totalDistributed,
    dustRemainder: totalPayoutAtoms - totalDistributed,
  };
}

export function formatRwaSupply(rawStr: string, decimals: number): string {
  try {
    const raw = BigInt(rawStr);
    if (raw === 0n) return "0";
    const base = 10n ** BigInt(decimals);
    const whole = raw / base;
    const frac = raw % base;
    if (frac === 0n) return whole.toLocaleString("en-US");
    const fracStr = frac.toString().padStart(decimals, "0").slice(0, 2).replace(/0+$/, "");
    return fracStr ? `${whole.toLocaleString("en-US")}.${fracStr}` : whole.toLocaleString("en-US");
  } catch {
    return rawStr;
  }
}
