import { buildContractInspectorDeepLink } from "../contracts/dry-run";
import { ADDRESS_LENGTH, decodeAddress, hexToKvnc } from "../wallet/address";

export interface SearchShortcutAction {
  id: string;
  label: string;
  description: string;
  href: string;
  badge: string;
}

export const MAX_SHORTCUT_QUERY_LENGTH = 256;

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;
const HEX_32_WITH_PREFIX_PATTERN = /^0[xX][0-9a-fA-F]{64}$/;
const HEX_32_BARE_PATTERN = /^[0-9a-fA-F]{64}$/;
const UNSAFE_HTML_CHAR_PATTERN = /[<>"'`\\]/;

function hasUnsafeQueryChars(value: string): boolean {
  if (UNSAFE_HTML_CHAR_PATTERN.test(value)) return true;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

function resolveCanonicalAddress(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();
  if (lower.startsWith("kvnc") || lower.endsWith("dag")) {
    if (lower.length !== ADDRESS_LENGTH || !lower.startsWith("kvnc") || !lower.endsWith("dag")) {
      return null;
    }
    try {
      decodeAddress(lower);
      return lower;
    } catch {
      return null;
    }
  }

  if (HEX_32_WITH_PREFIX_PATTERN.test(trimmed)) {
    return hexToKvnc(trimmed.slice(2).toLowerCase());
  }

  if (HEX_32_BARE_PATTERN.test(trimmed)) {
    return hexToKvnc(trimmed.toLowerCase());
  }

  return null;
}

function shortenMiddle(value: string, head = 10, tail = 6): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

function buildAddressShortcuts(canonicalAddress: string): SearchShortcutAction[] {
  const short = shortenMiddle(canonicalAddress);
  return [
    {
      id: "inspect-address",
      label: "Inspect Address / Contract",
      description: `Inspect account balances, activity, and contract metadata for ${short}`,
      href: `/explorer?address=${encodeURIComponent(canonicalAddress)}`,
      badge: "Address",
    },
    {
      id: "open-contract-inspector",
      label: "Open in Contract Inspector",
      description: `Dry-run calls, read storage, and inspect contract ${short}`,
      href: `/explorer?tab=contracts&contract=${encodeURIComponent(canonicalAddress)}`,
      badge: "Contract",
    },
  ];
}

function buildReceiptShortcut(txHash: string): SearchShortcutAction {
  const short = shortenMiddle(txHash);
  return {
    id: "inspect-receipt",
    label: "Inspect Receipt & Decode Logs",
    description: `Inspect execution receipt and decode emitted logs for ${short}`,
    href: `/explorer?tab=contracts&tx=${encodeURIComponent(txHash)}`,
    badge: "Receipt",
  };
}

/**
 * Pure helper that resolves an Explorer global search query into quick-jump
 * shortcut actions for Name Registry lookups, Contract/Address inspection,
 * storage reading, and transaction receipt/log decoding.
 *
 * Rejects empty, malformed, oversized, or XSS-tainted inputs without throwing.
 */
export function resolveSearchShortcuts(rawQuery: string): SearchShortcutAction[] {
  if (typeof rawQuery !== "string") return [];
  if (rawQuery.length > MAX_SHORTCUT_QUERY_LENGTH) return [];

  const trimmed = rawQuery.trim();
  if (!trimmed) return [];
  if (hasUnsafeQueryChars(trimmed)) return [];

  // 1. Name Registry lookup: `name:<name>`
  if (/^name:/i.test(trimmed)) {
    const candidateName = trimmed.slice(5).trim().toLowerCase();
    if (!candidateName || !NAME_PATTERN.test(candidateName)) {
      return [];
    }

    const resolveHref = buildContractInspectorDeepLink({
      presetId: "name_resolve",
      fields: { name: candidateName },
    });

    return [
      {
        id: "name-resolve",
        label: "Resolve Name in Contract Inspector",
        description: `Resolve "${candidateName}" via the on-chain Name Registry (name_resolve)`,
        href: resolveHref,
        badge: "Name",
      },
      {
        id: "storage-read",
        label: "Read Storage Slot",
        description: `Inspect raw contract storage slots for "${candidateName}"`,
        href: "/explorer?tab=contracts&preset=name_resolve",
        badge: "Storage",
      },
    ];
  }

  // 2. Explicit transaction hash prefix: `tx:<hash>` / `txn:<hash>` / `transaction:<hash>`
  const txPrefixMatch = trimmed.match(/^(?:tx|txn|transaction):\s*(.+)$/i);
  if (txPrefixMatch) {
    const payload = txPrefixMatch[1]?.trim() ?? "";
    if (!HEX_32_WITH_PREFIX_PATTERN.test(payload) && !HEX_32_BARE_PATTERN.test(payload)) {
      return [];
    }
    const cleanHex = payload.replace(/^0[xX]/, "").toLowerCase();
    return [buildReceiptShortcut(`0x${cleanHex}`)];
  }

  // 3. Explicit address/contract prefix: `addr:` / `address:` / `account:` / `contract:`
  const addrPrefixMatch = trimmed.match(/^(?:addr|address|account|contract):\s*(.+)$/i);
  if (addrPrefixMatch) {
    const payload = addrPrefixMatch[1]?.trim() ?? "";
    const canonical = resolveCanonicalAddress(payload);
    if (!canonical) return [];
    return buildAddressShortcuts(canonical);
  }

  // 4. 32-byte `0x...` hex hash (valid as both a tx receipt hash and a 32-byte hex address)
  if (HEX_32_WITH_PREFIX_PATTERN.test(trimmed)) {
    const txHash = `0x${trimmed.slice(2).toLowerCase()}`;
    const canonical = resolveCanonicalAddress(trimmed);
    const actions: SearchShortcutAction[] = [buildReceiptShortcut(txHash)];
    if (canonical) {
      actions.push(...buildAddressShortcuts(canonical));
    }
    return actions;
  }

  // 5. Valid canonical `kvnc...dag` address or bare 32-byte hex address
  const canonical = resolveCanonicalAddress(trimmed);
  if (canonical) {
    return buildAddressShortcuts(canonical);
  }

  return [];
}
