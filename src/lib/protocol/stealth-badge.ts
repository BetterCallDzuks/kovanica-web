/**
 * KVP-103 Stealth Badge extraction & deep-link helpers for the Explorer.
 *
 * Detects KVP-103 stealth announcements on transactions from:
 * 1. Explicit stealth metadata fields (`stealth_announcement`, `ephemeral_pubkey`, `view_tag`),
 * 2. Stealth memo/tag payloads (`kvp103:<viewTag>:<ephemeralHex>` or JSON),
 * 3. Public `/api/stealth/announcements` cross-referenced by `txHash` or recipient `stealthAddress`.
 */
import type { ApiTx } from "@/lib/networkConstants";
import type { Tx } from "@/lib/ledger/types";
import type { StealthAnnouncement } from "@/lib/protocol/stealth";
import { parseAddr } from "@/lib/wallet/address";

export type StealthBadgeSource = "tx" | "memo" | "announcement";

export type StealthBadgeInfo = {
  /** 4-char lowercase hex view tag (without 0x prefix). */
  viewTag: string;
  /** 64-char lowercase hex ephemeral public key R. */
  ephemeralPubkeyHex: string;
  /** Optional canonical or hex stealth recipient address. */
  stealthAddress?: string;
  /** Where the stealth announcement was detected. */
  source: StealthBadgeSource;
};

const HEX64_RE = /^(?:0x)?([0-9a-fA-F]{64})$/;
const HEX4_RE = /^(?:0x)?([0-9a-fA-F]{4})$/;
const MEMO_PREFIX_RE = /(?:kvp-?103|stealth)[:\s]+(?:0x)?([0-9a-fA-F]{4})[:\s]+(?:0x)?([0-9a-fA-F]{64})/i;

function normHex64(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = HEX64_RE.exec(value.trim());
  return match ? match[1]!.toLowerCase() : null;
}

function normHex4(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = HEX4_RE.exec(value.trim());
  return match ? match[1]!.toLowerCase() : null;
}

function extractFromRecord(
  rec: Record<string, unknown>,
  source: StealthBadgeSource,
): StealthBadgeInfo | null {
  const eph = normHex64(
    rec.ephemeralPubkeyHex ??
      rec.ephemeral_pubkey_hex ??
      rec.ephemeral_pubkey ??
      rec.ephemeralPubkey,
  );
  const tag = normHex4(rec.viewTag ?? rec.view_tag ?? rec.stealth_view_tag);
  if (!eph || !tag) return null;
  const addrRaw = rec.stealthAddress ?? rec.stealth_address;
  return {
    viewTag: tag,
    ephemeralPubkeyHex: eph,
    ...(typeof addrRaw === "string" && addrRaw.trim() ? { stealthAddress: addrRaw.trim() } : {}),
    source,
  };
}

function extractFromMemoString(memo: string): StealthBadgeInfo | null {
  const trimmed = memo.trim();
  if (!trimmed) return null;

  const prefixMatch = MEMO_PREFIX_RE.exec(trimmed);
  if (prefixMatch) {
    return {
      viewTag: prefixMatch[1]!.toLowerCase(),
      ephemeralPubkeyHex: prefixMatch[2]!.toLowerCase(),
      source: "memo",
    };
  }

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return extractFromRecord(parsed as Record<string, unknown>, "memo");
      }
    } catch {
      // ignore non-JSON memos
    }
  }
  return null;
}

/**
 * Inspect an Explorer transaction (and optional public stealth announcements feed)
 * and return KVP-103 badge metadata if the transaction carries or matches a stealth
 * announcement. Returns `null` for ordinary non-stealth transactions.
 */
export function extractStealthBadgeInfo(
  tx: ApiTx | Tx,
  announcements?: readonly StealthAnnouncement[],
): StealthBadgeInfo | null {
  const txObj = tx as Record<string, unknown>;
  const kindObj =
    typeof tx.kind === "object" && tx.kind !== null ? (tx.kind as Record<string, unknown>) : null;

  // 1. Direct stealth fields on tx or nested stealth_announcement / stealthAnnouncement / kind
  const directCandidates: unknown[] = [
    txObj,
    txObj.stealth,
    txObj.stealth_announcement,
    txObj.stealthAnnouncement,
    kindObj,
    kindObj?.stealth,
    kindObj?.stealth_announcement,
    kindObj?.stealthAnnouncement,
  ];
  for (const cand of directCandidates) {
    if (cand && typeof cand === "object" && !Array.isArray(cand)) {
      const found = extractFromRecord(cand as Record<string, unknown>, "tx");
      if (found) return found;
    }
  }

  // 2. Memo / tag string on tx or kind
  const memoCandidates = [txObj.memo, txObj.tag, kindObj?.memo, kindObj?.tag];
  for (const memo of memoCandidates) {
    if (typeof memo === "string") {
      const found = extractFromMemoString(memo);
      if (found) return found;
    }
  }

  // 3. Cross-reference against public KVP-103 announcement board
  if (announcements && announcements.length > 0) {
    const txHashHex = normHex64(tx.id);
    const recipientAddresses = new Set<string>();
    const addRecipient = (raw: unknown) => {
      if (typeof raw !== "string") return;
      const hex = parseAddr(raw);
      if (hex) recipientAddresses.add(hex);
    };

    if ("to" in tx) addRecipient(tx.to);
    if (kindObj) addRecipient(kindObj.to);
    if ("outputs" in tx && Array.isArray(tx.outputs)) {
      for (const out of tx.outputs) {
        addRecipient(out.owner);
      }
    }

    for (const ann of announcements) {
      const annEph = normHex64(ann.ephemeralPubkeyHex);
      const annTag = normHex4(ann.viewTag);
      if (!annEph || !annTag) continue;

      const annTxHex = ann.txHash ? normHex64(ann.txHash) : null;
      if (txHashHex && annTxHex && txHashHex === annTxHex) {
        return {
          viewTag: annTag,
          ephemeralPubkeyHex: annEph,
          stealthAddress: ann.stealthAddress,
          source: "announcement",
        };
      }

      const annAddrHex =
        normHex64(ann.stealthAddressHex) ?? (ann.stealthAddress ? parseAddr(ann.stealthAddress) : null);
      if (annAddrHex && recipientAddresses.has(annAddrHex)) {
        return {
          viewTag: annTag,
          ephemeralPubkeyHex: annEph,
          stealthAddress: ann.stealthAddress,
          source: "announcement",
        };
      }
    }
  }

  return null;
}

/**
 * Build a sanitized `/stealth` deep-link URL pre-populating the Scan tab with
 * the detected view tag and ephemeral pubkey.
 */
export function buildStealthScanUrl(info: Pick<StealthBadgeInfo, "viewTag" | "ephemeralPubkeyHex">): string {
  const tag = normHex4(info.viewTag);
  const eph = normHex64(info.ephemeralPubkeyHex);
  if (!tag || !eph) return "/stealth";
  const params = new URLSearchParams();
  params.set("tab", "scan");
  params.set("view_tag", tag);
  params.set("ephemeral", eph);
  return `/stealth?${params.toString()}`;
}
