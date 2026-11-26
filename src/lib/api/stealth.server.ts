/**
 * Public KVP-103 Stealth Announcement Bulletin Board (server-side JSONL store).
 *
 * Stores ONLY public, non-secret announcement tuples:
 *   `{ ephemeralPubkeyHex, viewTag, stealthAddress, stealthAddressHex, txHash?, createdAt }`
 *
 * Strictly rejects any request containing private-key fields so secrets can
 * never be accidentally persisted or logged.
 */
import fs from "node:fs";
import path from "node:path";
import { hexToKvnc, parseAddr } from "@/lib/wallet/address";

export type StoredStealthAnnouncement = {
  ephemeralPubkeyHex: string;
  viewTag: string;
  stealthAddress: string;
  stealthAddressHex: string;
  txHash?: string;
  createdAt: string;
};

const MAX_ANNOUNCEMENTS = 5_000;
const FORBIDDEN_SECRET_KEYS = [
  "scan_privkey",
  "scan_privkey_hex",
  "spend_privkey",
  "spend_privkey_hex",
  "private_key",
  "privkey",
  "mnemonic",
  "seed",
];

function storePath(): string {
  const custom = process.env.KOVANICA_STEALTH_FILE?.trim();
  if (custom) return custom;
  return path.resolve(process.cwd(), "data", "stealth-announcements.jsonl");
}

function readAll(): StoredStealthAnnouncement[] {
  const file = storePath();
  try {
    if (!fs.existsSync(file)) return [];
    const raw = fs.readFileSync(file, "utf8");
    const rows: StoredStealthAnnouncement[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as StoredStealthAnnouncement;
        if (
          parsed &&
          typeof parsed.ephemeralPubkeyHex === "string" &&
          typeof parsed.stealthAddressHex === "string"
        ) {
          rows.push(parsed);
        }
      } catch {
        // skip malformed lines
      }
    }
    return rows;
  } catch {
    return [];
  }
}

export function listStealthAnnouncements(options?: {
  viewTag?: string | null;
  limit?: number;
}): StoredStealthAnnouncement[] {
  const tag = options?.viewTag?.trim().toLowerCase() || null;
  const limit = Math.min(Math.max(options?.limit ?? 200, 1), 1_000);
  const all = readAll();
  const filtered = tag ? all.filter((r) => r.viewTag.toLowerCase() === tag) : all;
  return filtered.slice(-limit).reverse();
}

export function addStealthAnnouncement(
  payload: Record<string, unknown>,
): { ok: true; announcement: StoredStealthAnnouncement } | { ok: false; error: string; status: number } {
  for (const key of Object.keys(payload)) {
    if (FORBIDDEN_SECRET_KEYS.includes(key.toLowerCase())) {
      return {
        ok: false,
        error: `Forbidden secret field '${key}' rejected — private keys must never be sent to the server`,
        status: 400,
      };
    }
  }

  const ephRaw = String(payload.ephemeral_pubkey_hex ?? payload.ephemeralPubkeyHex ?? "")
    .trim()
    .replace(/^0x/i, "")
    .toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(ephRaw)) {
    return { ok: false, error: "ephemeral_pubkey_hex must be 64 hex characters", status: 400 };
  }

  const tagRaw = String(payload.view_tag ?? payload.viewTag ?? "")
    .trim()
    .replace(/^0x/i, "")
    .toLowerCase();
  if (!/^[0-9a-f]{4}$/.test(tagRaw)) {
    return { ok: false, error: "view_tag must be 4 hex characters (2 bytes)", status: 400 };
  }

  const addrRaw = String(payload.stealth_address ?? payload.stealthAddress ?? "").trim();
  const addrHex = parseAddr(addrRaw);
  if (!addrHex) {
    return {
      ok: false,
      error: "stealth_address must be a valid kvnc…dag or 64-hex Kovanica address",
      status: 400,
    };
  }

  const txRaw = payload.tx_hash ?? payload.txHash;
  let txHash: string | undefined;
  if (typeof txRaw === "string" && txRaw.trim().length > 0) {
    const cleanTx = txRaw.trim().replace(/^0x/i, "").toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(cleanTx)) {
      return { ok: false, error: "tx_hash must be 64 hex characters", status: 400 };
    }
    txHash = `0x${cleanTx}`;
  }

  const existing = readAll();
  const duplicate = existing.find((r) => r.ephemeralPubkeyHex === ephRaw);
  if (duplicate) {
    return { ok: true, announcement: duplicate };
  }

  const announcement: StoredStealthAnnouncement = {
    ephemeralPubkeyHex: ephRaw,
    viewTag: tagRaw,
    stealthAddress: hexToKvnc(addrHex),
    stealthAddressHex: addrHex,
    ...(txHash ? { txHash } : {}),
    createdAt: new Date().toISOString(),
  };

  try {
    const file = storePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (existing.length >= MAX_ANNOUNCEMENTS) {
      const trimmed = [...existing.slice(-(MAX_ANNOUNCEMENTS - 1)), announcement];
      fs.writeFileSync(file, `${trimmed.map((r) => JSON.stringify(r)).join("\n")}\n`, "utf8");
    } else {
      fs.appendFileSync(file, `${JSON.stringify(announcement)}\n`, "utf8");
    }
  } catch (err) {
    return {
      ok: false,
      error: `Failed to persist announcement: ${err instanceof Error ? err.message : String(err)}`,
      status: 500,
    };
  }

  return { ok: true, announcement };
}
