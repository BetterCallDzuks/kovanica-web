/**
 * Explorer and Navbar Search Resolver.
 * Resolves:
 * 1. Canonical PRO-21 addresses (64-char kvnc...dag) and hex public keys -> address / account views.
 * 2. Token / Collection IDs (e.g. token IDs, collection hex/hash, or RWA asset IDs) ->
 *    /routes/wallet/collection.$collectionId.tsx, /routes/wallet/nft.$assetId.tsx, or /routes/explorer/rwa.$assetId.tsx.
 * 3. 32-byte / 64-char hex block digests and transaction hashes -> block / transaction views.
 * 4. Clear error/unrecognized feedback or empty states for malformed search queries without throwing router exceptions.
 */

import {
  parseAddr,
  decodeAddress,
  hexToKvnc,
  toCanonicalAddress,
  ADDRESS_LENGTH,
} from "@/lib/wallet/address";
import { isAssetId } from "@/lib/asset-id";
export interface BlockLookupItem {
  id: string;
  txs?: Array<{ id: string }>;
}

export type QueryType =
  | "address"
  | "pubkey"
  | "block"
  | "tx"
  | "collection"
  | "nft"
  | "rwa"
  | "token"
  | "ambiguous_hex"
  | "malformed"
  | "unrecognized"
  | "empty";

export interface RouteTarget {
  type: "address" | "block" | "tx" | "collection" | "nft" | "rwa" | "token";
  path: string;
  search?: Record<string, string>;
  params?: Record<string, string>;
  url: string;
  label: string;
  description: string;
  badge: string;
}

export interface ParseResult {
  raw: string;
  cleaned: string;
  prefix?: string;
  type: QueryType;
  error?: string;
  canonicalAddress?: string;
  cleanHex?: string;
  tokenSymbol?: string;
}

export interface ResolutionResult {
  ok: boolean;
  query: string;
  parse: ParseResult;
  target?: RouteTarget;
  candidates?: RouteTarget[];
  error?: string;
  empty?: boolean;
}

const KNOWN_TOKENS = new Set(["KVNC", "KUNA", "INK", "COPPER", "PAPER"]);

export interface ResolveOptions {
  source?: string;
  blocks?: BlockLookupItem[];
  probeEndpoints?: boolean;
}

/**
 * Parses and classifies a raw search query into its structural category.
 * Never throws exceptions.
 */
export function parseSearchQuery(raw: string): ParseResult {
  const cleaned = raw.trim();
  if (!cleaned) {
    return {
      raw,
      cleaned: "",
      type: "empty",
    };
  }

  // Check explicit prefixes: e.g. "block:...", "tx:...", "addr:...", "nft:...", etc.
  const prefixMatch = cleaned.match(/^([a-z_]+):(.*)$/i);
  if (prefixMatch) {
    const prefix = prefixMatch[1]!.toLowerCase();
    const payload = prefixMatch[2]!.trim();

    if (!payload) {
      return {
        raw,
        cleaned,
        prefix,
        type: "malformed",
        error: `Prefix '${prefix}:' provided with empty query payload.`,
      };
    }

    switch (prefix) {
      case "addr":
      case "address":
      case "account": {
        const canonical = toCanonicalAddress(payload);
        if (canonical) {
          return {
            raw,
            cleaned,
            prefix,
            type: "address",
            canonicalAddress: canonical,
          };
        }
        return {
          raw,
          cleaned,
          prefix,
          type: "malformed",
          error: `Malformed address: '${payload}' is not a valid PRO-21 address or public key.`,
        };
      }

      case "pubkey":
      case "key": {
        const hex = payload.replace(/^0x/i, "");
        if (/^[0-9a-f]{64}$/i.test(hex)) {
          const canonical = hexToKvnc(hex);
          return {
            raw,
            cleaned,
            prefix,
            type: "pubkey",
            cleanHex: hex.toLowerCase(),
            canonicalAddress: canonical,
          };
        }
        return {
          raw,
          cleaned,
          prefix,
          type: "malformed",
          error: `Malformed public key: expected 64 hex characters (got ${payload.length}).`,
        };
      }

      case "block":
      case "blk": {
        const hex = payload.replace(/^0x/i, "");
        if (/^[0-9a-f]{64}$/i.test(hex)) {
          return {
            raw,
            cleaned,
            prefix,
            type: "block",
            cleanHex: hex.toLowerCase(),
          };
        }
        return {
          raw,
          cleaned,
          prefix,
          type: "malformed",
          error: `Malformed block digest: expected 64 hex characters (got ${payload.length}).`,
        };
      }

      case "tx":
      case "txn":
      case "transaction": {
        const hex = payload.replace(/^0x/i, "");
        if (/^[0-9a-f]{64}$/i.test(hex)) {
          return {
            raw,
            cleaned,
            prefix,
            type: "tx",
            cleanHex: hex.toLowerCase(),
          };
        }
        return {
          raw,
          cleaned,
          prefix,
          type: "malformed",
          error: `Malformed transaction hash: expected 64 hex characters (got ${payload.length}).`,
        };
      }

      case "collection":
      case "col": {
        const hex = payload.replace(/^0x/i, "");
        if (/^[0-9a-f]{64}$/i.test(hex)) {
          return {
            raw,
            cleaned,
            prefix,
            type: "collection",
            cleanHex: hex.toLowerCase(),
          };
        }
        return {
          raw,
          cleaned,
          prefix,
          type: "malformed",
          error: `Malformed collection ID: expected 64 hex characters (got ${payload.length}).`,
        };
      }

      case "nft":
      case "nft_asset": {
        const hex = payload.replace(/^0x/i, "");
        if (/^[0-9a-f]{64}$/i.test(hex)) {
          return {
            raw,
            cleaned,
            prefix,
            type: "nft",
            cleanHex: hex.toLowerCase(),
          };
        }
        return {
          raw,
          cleaned,
          prefix,
          type: "malformed",
          error: `Malformed NFT asset ID: expected 64 hex characters (got ${payload.length}).`,
        };
      }

      case "rwa":
      case "rwa_asset": {
        const hex = payload.replace(/^0x/i, "");
        if (/^[0-9a-f]{64}$/i.test(hex)) {
          return {
            raw,
            cleaned,
            prefix,
            type: "rwa",
            cleanHex: hex.toLowerCase(),
          };
        }
        return {
          raw,
          cleaned,
          prefix,
          type: "malformed",
          error: `Malformed RWA asset ID: expected 64 hex characters (got ${payload.length}).`,
        };
      }

      case "token": {
        const upper = payload.toUpperCase();
        if (KNOWN_TOKENS.has(upper)) {
          return {
            raw,
            cleaned,
            prefix,
            type: "token",
            tokenSymbol: upper,
          };
        }
        const hex = payload.replace(/^0x/i, "");
        if (/^[0-9a-f]{64}$/i.test(hex)) {
          return {
            raw,
            cleaned,
            prefix,
            type: "token",
            cleanHex: hex.toLowerCase(),
          };
        }
        return {
          raw,
          cleaned,
          prefix,
          type: "token",
          tokenSymbol: upper,
        };
      }

      default:
        // Unknown prefix — treat as unrecognized
        return {
          raw,
          cleaned,
          prefix,
          type: "unrecognized",
          error: `Unrecognized prefix '${prefix}:'. Valid prefixes: address:, pubkey:, block:, tx:, collection:, nft:, rwa:, token:.`,
        };
    }
  }

  // Check canonical PRO-21 address: kvnc...dag (64 chars)
  const lower = cleaned.toLowerCase();
  if (lower.startsWith("kvnc") || lower.endsWith("dag")) {
    if (lower.length !== ADDRESS_LENGTH) {
      return {
        raw,
        cleaned,
        type: "malformed",
        error: `Malformed PRO-21 address: expected exactly ${ADDRESS_LENGTH} characters starting with 'kvnc' and ending with 'dag' (got ${cleaned.length}).`,
      };
    }
    if (!lower.startsWith("kvnc") || !lower.endsWith("dag")) {
      return {
        raw,
        cleaned,
        type: "malformed",
        error: "Malformed address: PRO-21 address must start with 'kvnc' and end with 'dag'.",
      };
    }
    try {
      decodeAddress(lower);
      return {
        raw,
        cleaned,
        type: "address",
        canonicalAddress: lower,
      };
    } catch (err) {
      return {
        raw,
        cleaned,
        type: "malformed",
        error: `Malformed PRO-21 address: ${err instanceof Error ? err.message : "invalid checksum or characters"}.`,
      };
    }
  }

  // Check 32-byte hex digest (64 hex characters, optionally 0x-prefixed)
  const bareHex = cleaned.replace(/^0x/i, "");
  if (/^[0-9a-f]{64}$/i.test(bareHex)) {
    const cleanHex = bareHex.toLowerCase();
    const canonical = hexToKvnc(cleanHex);
    return {
      raw,
      cleaned,
      type: "ambiguous_hex",
      cleanHex,
      canonicalAddress: canonical,
    };
  }

  // Check 66-hex versioned public key (00 + 64 hex)
  if (/^00[0-9a-f]{64}$/i.test(bareHex)) {
    const cleanHex = bareHex.slice(2).toLowerCase();
    const canonical = hexToKvnc(cleanHex);
    return {
      raw,
      cleaned,
      type: "pubkey",
      cleanHex,
      canonicalAddress: canonical,
    };
  }

  // Check known token symbols (e.g. KUNA, KVNC, INK, COPPER, PAPER)
  const upperQuery = cleaned.toUpperCase();
  if (KNOWN_TOKENS.has(upperQuery)) {
    return {
      raw,
      cleaned,
      type: "token",
      tokenSymbol: upperQuery,
    };
  }

  // Check legacy base58 address fallback via parseAddr
  const parsedLegacy = parseAddr(cleaned);
  if (parsedLegacy) {
    const canonical = hexToKvnc(parsedLegacy);
    return {
      raw,
      cleaned,
      type: "address",
      canonicalAddress: canonical,
      cleanHex: parsedLegacy,
    };
  }

  // Check if it looks like a hex digest of wrong length
  if (/^(0x)?[0-9a-f]+$/i.test(cleaned)) {
    return {
      raw,
      cleaned,
      type: "malformed",
      error: `Malformed hex hash: expected 64 hex characters (got ${bareHex.length}).`,
    };
  }

  // Otherwise: completely unrecognized
  return {
    raw,
    cleaned,
    type: "unrecognized",
    error: `Unrecognized search query “${cleaned}”. Enter a canonical PRO-21 address (kvnc…dag), 64-hex hash, or token ID.`,
  };
}

/**
 * Generates RouteTarget candidates for a 32-byte hex hash.
 */
export function buildHexCandidates(hex: string): RouteTarget[] {
  const canonicalAddr = hexToKvnc(hex);
  return [
    {
      type: "block",
      path: "/explorer",
      search: { block: hex },
      url: `/explorer?block=${hex}`,
      label: "Block Digest",
      description: "View block details, score, parents, and executed transactions",
      badge: "Block",
    },
    {
      type: "tx",
      path: "/explorer",
      search: { tx: hex },
      url: `/explorer?tx=${hex}`,
      label: "Transaction Hash",
      description: "View transaction details, inputs, outputs, and contract decoding",
      badge: "Transaction",
    },
    {
      type: "address",
      path: "/wallet",
      search: { address: canonicalAddr },
      url: `/wallet?address=${canonicalAddr}`,
      label: `Account (${canonicalAddr.slice(0, 8)}…${canonicalAddr.slice(-6)})`,
      description: "View account balance, UTXOs, and transaction history in Wallet",
      badge: "Account",
    },
    {
      type: "collection",
      path: "/wallet/collection/$collectionId",
      params: { collectionId: hex },
      url: `/wallet/collection/${hex}`,
      label: "Collection ID",
      description: "View NFT collection, metadata, and collection items",
      badge: "Collection",
    },
    {
      type: "nft",
      path: "/wallet/nft/$assetId",
      params: { assetId: hex },
      url: `/wallet/nft/${hex}`,
      label: "NFT Asset ID",
      description: "View individual NFT metadata, ownership, and provenance",
      badge: "NFT",
    },
    {
      type: "rwa",
      path: "/explorer/rwa/$assetId",
      params: { assetId: hex },
      url: `/explorer/rwa/${hex}`,
      label: "RWA Asset ID",
      description: "View Real World Asset legal backing, custody, and attestations",
      badge: "RWA",
    },
  ];
}

/**
 * Resolves a search query to a specific target route or candidate options.
 * Synchronous resolution based on syntax, prefixes, and in-memory DAG blocks.
 */
export function resolveSearchQuery(raw: string, options: ResolveOptions = {}): ResolutionResult {
  const parse = parseSearchQuery(raw);

  if (parse.type === "empty") {
    return {
      ok: false,
      empty: true,
      query: raw,
      parse,
      error: "Search query is empty.",
    };
  }

  if (parse.type === "malformed" || parse.type === "unrecognized") {
    return {
      ok: false,
      query: raw,
      parse,
      error: parse.error,
    };
  }

  // 1. Address / Public Key
  if (parse.type === "address" || parse.type === "pubkey") {
    const addr = parse.canonicalAddress!;
    const target: RouteTarget = {
      type: "address",
      path: "/wallet",
      search: { address: addr },
      url: `/wallet?address=${addr}`,
      label: "Account View",
      description: `View balance, history, and UTXOs for ${addr}`,
      badge: "PRO-21 Address",
    };
    return {
      ok: true,
      query: raw,
      parse,
      target,
    };
  }

  // 2. Explicit Block
  if (parse.type === "block") {
    const hex = parse.cleanHex!;
    const target: RouteTarget = {
      type: "block",
      path: "/explorer",
      search: { block: hex },
      url: `/explorer?block=${hex}`,
      label: "Block View",
      description: `Inspect BlockDAG block ${hex.slice(0, 8)}…${hex.slice(-6)}`,
      badge: "Block",
    };
    return {
      ok: true,
      query: raw,
      parse,
      target,
    };
  }

  // 3. Explicit Transaction
  if (parse.type === "tx") {
    const hex = parse.cleanHex!;
    const target: RouteTarget = {
      type: "tx",
      path: "/explorer",
      search: { tx: hex },
      url: `/explorer?tx=${hex}`,
      label: "Transaction View",
      description: `Inspect transaction ${hex.slice(0, 8)}…${hex.slice(-6)} in BlockDAG Explorer`,
      badge: "Transaction",
    };
    return {
      ok: true,
      query: raw,
      parse,
      target,
    };
  }

  // 4. Collection ID
  if (parse.type === "collection") {
    const hex = parse.cleanHex!;
    const target: RouteTarget = {
      type: "collection",
      path: "/wallet/collection/$collectionId",
      params: { collectionId: hex },
      url: `/wallet/collection/${hex}`,
      label: "Collection View",
      description: `View collection ${hex.slice(0, 8)}…${hex.slice(-6)}`,
      badge: "Collection",
    };
    return {
      ok: true,
      query: raw,
      parse,
      target,
    };
  }

  // 5. NFT Asset ID
  if (parse.type === "nft") {
    const hex = parse.cleanHex!;
    const target: RouteTarget = {
      type: "nft",
      path: "/wallet/nft/$assetId",
      params: { assetId: hex },
      url: `/wallet/nft/${hex}`,
      label: "NFT Asset View",
      description: `View NFT asset ${hex.slice(0, 8)}…${hex.slice(-6)}`,
      badge: "NFT",
    };
    return {
      ok: true,
      query: raw,
      parse,
      target,
    };
  }

  // 6. RWA Asset ID
  if (parse.type === "rwa") {
    const hex = parse.cleanHex!;
    const target: RouteTarget = {
      type: "rwa",
      path: "/explorer/rwa/$assetId",
      params: { assetId: hex },
      url: `/explorer/rwa/${hex}`,
      label: "RWA Asset View",
      description: `View Real World Asset ${hex.slice(0, 8)}…${hex.slice(-6)}`,
      badge: "RWA",
    };
    return {
      ok: true,
      query: raw,
      parse,
      target,
    };
  }

  // 7. Token (symbol or ID)
  if (parse.type === "token") {
    const sym = parse.tokenSymbol || parse.cleanHex;
    const target: RouteTarget = {
      type: "token",
      path: "/wallet/token-listings",
      url: "/wallet/token-listings",
      label: `Token Listings${sym ? ` (${sym})` : ""}`,
      description: "Discover, inspect, and trade tokens on Kovanica",
      badge: "Token",
    };
    return {
      ok: true,
      query: raw,
      parse,
      target,
    };
  }

  // 8. Ambiguous 32-byte Hex
  if (parse.type === "ambiguous_hex") {
    const hex = parse.cleanHex!;
    const candidates = buildHexCandidates(hex);

    // If options.blocks is provided, check if hex matches a known DAG block or tx
    if (options.blocks && options.blocks.length > 0) {
      const matchedBlock = options.blocks.find((b) => b.id.toLowerCase() === hex);
      if (matchedBlock) {
        return {
          ok: true,
          query: raw,
          parse,
          target: candidates[0]!, // Block candidate
          candidates,
        };
      }
      const matchedTxBlock = options.blocks.find((b) =>
        b.txs?.some((t) => t.id.toLowerCase() === hex),
      );
      if (matchedTxBlock) {
        return {
          ok: true,
          query: raw,
          parse,
          target: candidates[1]!, // Tx candidate
          candidates,
        };
      }
    }

    // Default target is block view in explorer, with all candidates available
    return {
      ok: true,
      query: raw,
      parse,
      target: candidates[0]!,
      candidates,
    };
  }

  return {
    ok: false,
    query: raw,
    parse,
    error: "Unable to resolve query.",
  };
}

/**
 * Asynchronously probes API endpoints for a 32-byte hex string to detect
 * whether it corresponds to an RWA, NFT, Collection, or Block/Tx.
 */
export async function resolveSearchQueryAsync(
  raw: string,
  options: ResolveOptions = {},
): Promise<ResolutionResult> {
  const syncRes = resolveSearchQuery(raw, options);

  // If not ambiguous hex or probing not requested, return sync result
  if (syncRes.parse.type !== "ambiguous_hex" || options.probeEndpoints === false) {
    return syncRes;
  }

  const hex = syncRes.parse.cleanHex!;
  const sourceQuery = options.source ? `?source=${encodeURIComponent(options.source)}` : "";

  try {
    // Probe rwa, nft, and collection in parallel with a short timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    const [rwaRes, nftRes, colRes] = await Promise.allSettled([
      fetch(`/api/rwa/${hex}${sourceQuery}`, { signal: controller.signal }).then((r) =>
        r.ok ? r.json() : null,
      ),
      fetch(`/api/nft/${hex}${sourceQuery}`, { signal: controller.signal }).then((r) =>
        r.ok ? r.json() : null,
      ),
      fetch(`/api/collection/${hex}${sourceQuery}`, { signal: controller.signal }).then((r) =>
        r.ok ? r.json() : null,
      ),
    ]);

    clearTimeout(timeout);

    if (rwaRes.status === "fulfilled" && rwaRes.value && isAssetId(rwaRes.value.asset_id)) {
      return {
        ok: true,
        query: raw,
        parse: syncRes.parse,
        target: {
          type: "rwa",
          path: "/explorer/rwa/$assetId",
          params: { assetId: hex },
          url: `/explorer/rwa/${hex}`,
          label: "RWA Asset View",
          description: `Identified RWA asset ${hex.slice(0, 8)}…`,
          badge: "RWA Asset",
        },
        candidates: syncRes.candidates,
      };
    }

    if (nftRes.status === "fulfilled" && nftRes.value && isAssetId(nftRes.value.asset_id)) {
      return {
        ok: true,
        query: raw,
        parse: syncRes.parse,
        target: {
          type: "nft",
          path: "/wallet/nft/$assetId",
          params: { assetId: hex },
          url: `/wallet/nft/${hex}`,
          label: "NFT Asset View",
          description: `Identified NFT asset ${hex.slice(0, 8)}…`,
          badge: "NFT Asset",
        },
        candidates: syncRes.candidates,
      };
    }

    if (colRes.status === "fulfilled" && colRes.value && isAssetId(colRes.value.collection_id)) {
      return {
        ok: true,
        query: raw,
        parse: syncRes.parse,
        target: {
          type: "collection",
          path: "/wallet/collection/$collectionId",
          params: { collectionId: hex },
          url: `/wallet/collection/${hex}`,
          label: "Collection View",
          description: `Identified NFT collection ${hex.slice(0, 8)}…`,
          badge: "Collection",
        },
        candidates: syncRes.candidates,
      };
    }
  } catch {
    // If probing fails or throws, gracefully fallback to the synchronous resolution
  }

  return syncRes;
}
