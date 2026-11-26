/**
 * KVP-103 / RFC-003 — Client-Side Dual-Key Stealth Addresses on Ed25519.
 *
 * Works natively on Kovanica L1 (Chain 2 Testnet & Mainnet) with zero consensus
 * changes: every derived one-time address is a standard Ed25519 Kovanica account
 * (`kvnc…dag`), and spends sign standard L1 sighashes with the derived one-time
 * scalar (`p = b + t mod L`) using RFC 8032 Ed25519 verification.
 *
 * Privacy invariants:
 * - Scan private key (`v`) and spend private key (`b`) NEVER leave the browser.
 * - Watch-only scanning uses ONLY `(v, B)` — `b` is never needed until spending.
 * - Announcements contain only public data `(R, viewTag, stealthAddress)`.
 */
import * as ed from "@noble/ed25519";
import { blake3 } from "@noble/hashes/blake3.js";
import { sha512 } from "@noble/hashes/sha2.js";
import { api, apiPostJson } from "@/lib/api/client";
import type { ApiHistory, ApiUtxos } from "@/lib/api/contract";
import { encodeAddress, hexToKvnc, parseAddr } from "@/lib/wallet/address";

// Ensure @noble/ed25519 has synchronous SHA-512 configured in both browser & Node.
if (!ed.hashes.sha512) {
  ed.hashes.sha512 = sha512;
}

const ED25519_L = (1n << 252n) + 27742317777372353535851937790883648493n;
const DOMAIN_TWEAK = new TextEncoder().encode("KVNC/stealth/tweak/v1");
const DOMAIN_TAG = new TextEncoder().encode("KVNC/stealth/tag/v1");
const DOMAIN_NONCE = new TextEncoder().encode("KVNC/stealth/nonce/v1");
const DOMAIN_SCAN_KEY = new TextEncoder().encode("KVNC/stealth/scan/v1");
const DOMAIN_SPEND_KEY = new TextEncoder().encode("KVNC/stealth/spend/v1");

export type StealthKeypair = {
  scanPrivkeyHex: string;
  scanPubkeyHex: string;
  spendPrivkeyHex: string;
  spendPubkeyHex: string;
  metaAddress: string;
};

export type StealthMetaAddress = {
  scanPubkeyHex: string;
  spendPubkeyHex: string;
  metaAddress: string;
};

export type StealthOnetime = {
  /** Canonical `kvnc…dag` one-time L1 address. */
  address: string;
  /** 64-char hex Ed25519 public key of the one-time L1 address. */
  addressHex: string;
  /** 64-char hex ephemeral public key `R = r·G` published by the sender. */
  ephemeralPubkeyHex: string;
  /** 4-char hex (2-byte) fast-filter view tag. */
  viewTag: string;
};

export type StealthAnnouncement = {
  ephemeralPubkeyHex: string;
  viewTag: string;
  stealthAddress: string;
  stealthAddressHex: string;
  txHash?: string;
  createdAt: string;
};

export type StealthScanHit = {
  address: string;
  addressHex: string;
  ephemeralPubkeyHex: string;
  viewTag: string;
  balanceAtoms: number;
  utxoCount: number;
  txHash?: string;
  createdAt?: string;
};

// --- Low-level byte & scalar helpers ------------------------------------------

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i]!.toString(16).padStart(2, "0");
  }
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().replace(/^0x/i, "");
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(clean)) {
    throw new Error("Invalid hex string");
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToBigintLE(bytes: Uint8Array): bigint {
  let acc = 0n;
  for (let i = bytes.length - 1; i >= 0; i -= 1) {
    acc = (acc << 8n) | BigInt(bytes[i]!);
  }
  return acc;
}

function bigintToBytes32LE(n: bigint): Uint8Array {
  let v = ((n % ED25519_L) + ED25519_L) % ED25519_L;
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

function reduceScalarModL(bytes: Uint8Array): bigint {
  const s = bytesToBigintLE(bytes) % ED25519_L;
  return s === 0n ? 1n : s;
}

function parseScalarHex(hex: string, label: string): bigint {
  const clean = hex.trim().replace(/^0x/i, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(clean)) {
    throw new Error(`${label} must be 64 hex characters (32 bytes)`);
  }
  const s = bytesToBigintLE(hexToBytes(clean)) % ED25519_L;
  if (s === 0n) {
    throw new Error(`${label} scalar cannot be zero`);
  }
  return s;
}

function parseValidPoint(hex: string, label: string): ed.Point {
  const clean = hex.trim().replace(/^0x/i, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(clean)) {
    throw new Error(`${label} must be a 64-char hex Ed25519 public key`);
  }
  const pt = ed.Point.fromHex(clean);
  if (pt.is0() || pt.isSmallOrder()) {
    throw new Error(`${label} is an invalid or small-order curve point`);
  }
  return pt;
}

function randomScalar(): bigint {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const rnd = ed.etc.randomBytes(64);
    const s = bytesToBigintLE(rnd) % ED25519_L;
    if (s !== 0n) return s;
  }
  throw new Error("Failed to sample non-zero Ed25519 scalar");
}

function sharedSecretTweakAndTag(sharedPointBytes: Uint8Array): { tweak: bigint; viewTag: string } {
  const tweakDigest = blake3(concatBytes([DOMAIN_TWEAK, sharedPointBytes]));
  const tagDigest = blake3(concatBytes([DOMAIN_TAG, sharedPointBytes]));
  return {
    tweak: reduceScalarModL(tweakDigest),
    viewTag: bytesToHex(tagDigest.subarray(0, 2)),
  };
}

// --- Meta-Address & Keypair Helpers -------------------------------------------

export function formatStealthMetaAddress(scanPubkeyHex: string, spendPubkeyHex: string): string {
  const scan = parseValidPoint(scanPubkeyHex, "Scan pubkey").toHex();
  const spend = parseValidPoint(spendPubkeyHex, "Spend pubkey").toHex();
  return `st:kvnc:${scan}:${spend}`;
}

export function parseStealthMetaAddress(metaAddress: string): StealthMetaAddress {
  const trimmed = metaAddress.trim();
  const match = /^st:kvnc:([0-9a-fA-F]{64}):([0-9a-fA-F]{64})$/.exec(trimmed);
  if (!match) {
    throw new Error("Invalid stealth meta-address: expected st:kvnc:<64-hex-scan>:<64-hex-spend>");
  }
  const scanPubkeyHex = parseValidPoint(match[1]!, "Scan pubkey").toHex();
  const spendPubkeyHex = parseValidPoint(match[2]!, "Spend pubkey").toHex();
  return {
    scanPubkeyHex,
    spendPubkeyHex,
    metaAddress: `st:kvnc:${scanPubkeyHex}:${spendPubkeyHex}`,
  };
}

/** Generate a fresh random KVP-103 dual-key stealth keypair locally in the browser. */
export function generateStealthKeypair(): StealthKeypair {
  const scanScalar = randomScalar();
  const spendScalar = randomScalar();
  const scanPubkeyHex = ed.Point.BASE.multiply(scanScalar).toHex();
  const spendPubkeyHex = ed.Point.BASE.multiply(spendScalar).toHex();
  return {
    scanPrivkeyHex: bytesToHex(bigintToBytes32LE(scanScalar)),
    scanPubkeyHex,
    spendPrivkeyHex: bytesToHex(bigintToBytes32LE(spendScalar)),
    spendPubkeyHex,
    metaAddress: `st:kvnc:${scanPubkeyHex}:${spendPubkeyHex}`,
  };
}

/**
 * Deterministically derive KVP-103 stealth keys from a wallet mnemonic so
 * users can recover their stealth identity from their 24-word backup phrase.
 */
export function deriveStealthKeypairFromMnemonic(mnemonic: string): StealthKeypair {
  const norm = mnemonic.trim().toLowerCase().replace(/\s+/g, " ");
  if (norm.split(" ").length < 12) {
    throw new Error("Mnemonic must contain at least 12 words");
  }
  const phraseBytes = new TextEncoder().encode(norm);
  const scanScalar = reduceScalarModL(blake3(concatBytes([DOMAIN_SCAN_KEY, phraseBytes])));
  const spendScalar = reduceScalarModL(blake3(concatBytes([DOMAIN_SPEND_KEY, phraseBytes])));
  const scanPubkeyHex = ed.Point.BASE.multiply(scanScalar).toHex();
  const spendPubkeyHex = ed.Point.BASE.multiply(spendScalar).toHex();
  return {
    scanPrivkeyHex: bytesToHex(bigintToBytes32LE(scanScalar)),
    scanPubkeyHex,
    spendPrivkeyHex: bytesToHex(bigintToBytes32LE(spendScalar)),
    spendPubkeyHex,
    metaAddress: `st:kvnc:${scanPubkeyHex}:${spendPubkeyHex}`,
  };
}

/** Construct a validated meta-address from scan and spend public keys (client-side). */
export function createStealthMeta(
  scanPubkeyHex: string,
  spendPubkeyHex: string,
): StealthMetaAddress {
  const metaAddress = formatStealthMetaAddress(scanPubkeyHex, spendPubkeyHex);
  return parseStealthMetaAddress(metaAddress);
}

// --- Sender: One-Time Stealth Address Derivation ------------------------------

/**
 * Derive a fresh, unlinkable one-time L1 address (`kvnc…dag`) for a recipient's
 * `st:kvnc:<scanPub>:<spendPub>` meta-address. Runs 100% client-side.
 */
export function deriveOnetimeAddress(
  metaAddress: string,
  ephemeralScalarOverride?: bigint,
): StealthOnetime {
  const { scanPubkeyHex, spendPubkeyHex } = parseStealthMetaAddress(metaAddress);
  const V = parseValidPoint(scanPubkeyHex, "Scan pubkey");
  const B = parseValidPoint(spendPubkeyHex, "Spend pubkey");

  const r = ephemeralScalarOverride ?? randomScalar();
  const R = ed.Point.BASE.multiply(r);
  const shared = V.multiply(r).toBytes();
  const { tweak, viewTag } = sharedSecretTweakAndTag(shared);

  const P = B.add(ed.Point.BASE.multiply(tweak));
  const pubBytes = P.toBytes();
  return {
    address: encodeAddress(pubBytes),
    addressHex: bytesToHex(pubBytes),
    ephemeralPubkeyHex: R.toHex(),
    viewTag,
  };
}

// --- Recipient: Client-Side ECDH Scanning -------------------------------------

/**
 * Test a single public announcement `(R, viewTag, stealthAddress)` locally using
 * ONLY `(scanPrivkeyHex, spendPubkeyHex)`. Never requires the spend private key.
 */
export function matchStealthAnnouncement(
  scanPrivkeyHex: string,
  spendPubkeyHex: string,
  announcement: {
    ephemeralPubkeyHex: string;
    viewTag?: string;
    stealthAddress?: string;
    stealthAddressHex?: string;
  },
): { matched: true; address: string; addressHex: string; viewTag: string } | { matched: false } {
  const v = parseScalarHex(scanPrivkeyHex, "Scan private key");
  const B = parseValidPoint(spendPubkeyHex, "Spend public key");

  let R: ed.Point;
  try {
    R = parseValidPoint(announcement.ephemeralPubkeyHex, "Ephemeral pubkey");
  } catch {
    return { matched: false };
  }

  const shared = R.multiply(v).toBytes();
  const { tweak, viewTag } = sharedSecretTweakAndTag(shared);

  if (announcement.viewTag && announcement.viewTag.toLowerCase() !== viewTag) {
    return { matched: false };
  }

  const P = B.add(ed.Point.BASE.multiply(tweak));
  const derivedHex = P.toHex();
  const expectedHex =
    announcement.stealthAddressHex?.toLowerCase().replace(/^0x/, "") ??
    (announcement.stealthAddress ? parseAddr(announcement.stealthAddress) : null);

  if (expectedHex && expectedHex !== derivedHex) {
    return { matched: false };
  }

  return {
    matched: true,
    address: hexToKvnc(derivedHex),
    addressHex: derivedHex,
    viewTag,
  };
}

// --- Recipient: One-Time Spend Key Derivation & RFC 8032 Scalar Signing -------

/**
 * Derive the one-time Ed25519 spend scalar `p = (b + t) mod L` and verify it
 * corresponds to the expected stealth address.
 */
export function deriveOnetimeSpendKey(params: {
  scanPrivkeyHex: string;
  spendPrivkeyHex: string;
  ephemeralPubkeyHex: string;
}): {
  oneTimeScalarHex: string;
  address: string;
  addressHex: string;
  viewTag: string;
} {
  const v = parseScalarHex(params.scanPrivkeyHex, "Scan private key");
  const b = parseScalarHex(params.spendPrivkeyHex, "Spend private key");
  const R = parseValidPoint(params.ephemeralPubkeyHex, "Ephemeral pubkey");

  const shared = R.multiply(v).toBytes();
  const { tweak, viewTag } = sharedSecretTweakAndTag(shared);

  const p = (b + tweak) % ED25519_L;
  if (p === 0n) {
    throw new Error("Derived one-time scalar is zero");
  }
  const P = ed.Point.BASE.multiply(p);
  const addressHex = P.toHex();
  return {
    oneTimeScalarHex: bytesToHex(bigintToBytes32LE(p)),
    address: hexToKvnc(addressHex),
    addressHex,
    viewTag,
  };
}

/**
 * Sign a 32-byte L1 transaction sighash hex directly with a derived one-time
 * Ed25519 scalar `p` (RFC 8032 compatible — verifies under standard Ed25519).
 */
export function signSighashWithStealthScalar(
  oneTimeScalarHex: string,
  sighashHex: string,
): { signatureHex: string; publicKeyHex: string } {
  const p = parseScalarHex(oneTimeScalarHex, "One-time spend scalar");
  const msg = hexToBytes(sighashHex);
  const P = ed.Point.BASE.multiply(p);
  const pubBytes = P.toBytes();

  // Deterministic nonce derived from scalar + message (RFC 8032 style)
  const scalarBytes = bigintToBytes32LE(p);
  const noncePrefix = blake3(concatBytes([DOMAIN_NONCE, scalarBytes]));
  const r = reduceScalarModL(sha512(concatBytes([noncePrefix, msg])));
  const R = ed.Point.BASE.multiply(r).toBytes();

  const k = bytesToBigintLE(sha512(concatBytes([R, pubBytes, msg]))) % ED25519_L;
  const s = (r + k * p) % ED25519_L;

  const sig = concatBytes([R, bigintToBytes32LE(s)]);
  return {
    signatureHex: bytesToHex(sig),
    publicKeyHex: bytesToHex(pubBytes),
  };
}

// --- Public Announcement Board & Live L1 Spend API ----------------------------

/** Publish a public stealth announcement (no secrets) so the recipient can discover it. */
export async function publishStealthAnnouncement(params: {
  ephemeralPubkeyHex: string;
  viewTag: string;
  stealthAddress: string;
  txHash?: string;
}): Promise<StealthAnnouncement> {
  const res = await apiPostJson<{ ok: boolean; announcement: StealthAnnouncement }>(
    "/api/stealth/announce",
    {
      ephemeral_pubkey_hex: params.ephemeralPubkeyHex,
      view_tag: params.viewTag,
      stealth_address: params.stealthAddress,
      tx_hash: params.txHash,
    },
  );
  return res.announcement;
}

/** Fetch public stealth announcements (optionally filtered by 4-hex view tag). */
export async function fetchStealthAnnouncements(viewTag?: string): Promise<StealthAnnouncement[]> {
  const suffix = viewTag?.trim() ? `?view_tag=${encodeURIComponent(viewTag.trim().toLowerCase())}` : "";
  const res = await api<{ announcements: StealthAnnouncement[] }>(
    `/api/stealth/announcements${suffix}`,
  );
  return Array.isArray(res?.announcements) ? res.announcements : [];
}

/**
 * Client-side scan of published announcements (plus optional manual ephemeral pubkeys).
 * Private keys stay strictly in the browser; only matched one-time addresses are
 * queried via `/api/utxos` for their live on-chain balance.
 */
export async function scanStealthOutputs(params: {
  scanPrivkeyHex: string;
  spendPubkeyHex: string;
  viewTagFilter?: string;
  manualEphemerals?: string[];
}): Promise<StealthScanHit[]> {
  const announcements = await fetchStealthAnnouncements(params.viewTagFilter).catch(() => []);

  const candidates: Array<{
    ephemeralPubkeyHex: string;
    viewTag?: string;
    stealthAddress?: string;
    stealthAddressHex?: string;
    txHash?: string;
    createdAt?: string;
  }> = [...announcements];

  for (const eph of params.manualEphemerals ?? []) {
    const clean = eph.trim().replace(/^0x/i, "").toLowerCase();
    if (/^[0-9a-f]{64}$/.test(clean)) {
      candidates.push({ ephemeralPubkeyHex: clean });
    }
  }

  const matched: Array<{
    address: string;
    addressHex: string;
    ephemeralPubkeyHex: string;
    viewTag: string;
    txHash?: string;
    createdAt?: string;
  }> = [];
  const seenAddr = new Set<string>();

  for (const c of candidates) {
    const res = matchStealthAnnouncement(params.scanPrivkeyHex, params.spendPubkeyHex, c);
    if (res.matched && !seenAddr.has(res.addressHex)) {
      seenAddr.add(res.addressHex);
      matched.push({
        address: res.address,
        addressHex: res.addressHex,
        ephemeralPubkeyHex: c.ephemeralPubkeyHex,
        viewTag: res.viewTag,
        txHash: c.txHash,
        createdAt: c.createdAt,
      });
    }
  }

  // Query live L1 balances for each matched stealth address
  const hits = await Promise.all(
    matched.map(async (m): Promise<StealthScanHit> => {
      try {
        const utxos = await fetchStealthUtxos(m.address);
        return {
          ...m,
          balanceAtoms: utxos.balance ?? 0,
          utxoCount: utxos.utxos?.length ?? 0,
        };
      } catch {
        return { ...m, balanceAtoms: 0, utxoCount: 0 };
      }
    }),
  );

  return hits;
}

export async function prepareStealthSpend(
  fromAddress: string,
  toAddress: string,
  amountAtoms: number,
): Promise<{ sighash: string; fee: number }> {
  return api<{ sighash: string; fee: number }>(
    `/api/prepare?from=${encodeURIComponent(fromAddress)}&to=${encodeURIComponent(toAddress)}&amount=${amountAtoms}`,
    "POST",
  );
}

export async function submitStealthSpend(
  fromAddress: string,
  toAddress: string,
  amountAtoms: number,
  sigHex: string,
): Promise<{ tx: string }> {
  return api<{ tx: string }>(
    `/api/submit?from=${encodeURIComponent(fromAddress)}&to=${encodeURIComponent(toAddress)}&amount=${amountAtoms}&sig=${encodeURIComponent(sigHex)}`,
    "POST",
  );
}

export async function fetchStealthUtxos(address: string): Promise<ApiUtxos> {
  return api<ApiUtxos>(`/api/utxos?address=${encodeURIComponent(address)}`);
}

export async function fetchStealthHistory(address: string): Promise<ApiHistory> {
  return api<ApiHistory>(`/api/history?address=${encodeURIComponent(address)}`);
}
