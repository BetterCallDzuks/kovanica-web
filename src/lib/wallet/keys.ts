import { hmac } from "@noble/hashes/hmac.js";
import { sha512 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import { normalizePhrase } from "./bip39";
import { ensureWasmReady, wasm } from "./wasm";

export { loadWordlist } from "./bip39";

/**
 * Wallet key facade — canonical SLIP-0010 / BIP-44 Ed25519 derivation.
 *
 * Uses PBKDF2-HMAC-SHA512 (BIP-39 64-byte seed) followed by SLIP-0010 Ed25519
 * hardened derivation at `m/44'/3007'/<account>'/0'/0'` — matching Android
 * Wallet, Android Node, Browser Extension, and `kovanica-sdk` (`deriveBip44`).
 *
 * Public keys, addresses, and signatures go through `@kovanica/sdk-wasm`.
 */

const ED25519_SLIP10_KEY = new TextEncoder().encode("ed25519 seed");
const HARDENED_OFFSET = 0x80000000;
const BIP44_PURPOSE = 44;
const KOVANICA_COIN_TYPE = 3007;

function deriveSlip10Bip44Key(seed64: Uint8Array, accountIndex = 0): Uint8Array {
  const safeIndex =
    Number.isInteger(accountIndex) && accountIndex >= 0 && accountIndex < HARDENED_OFFSET
      ? accountIndex
      : 0;
  let digest = hmac(sha512, ED25519_SLIP10_KEY, seed64);
  let key = digest.slice(0, 32);
  let chainCode = digest.slice(32, 64);

  const steps = [BIP44_PURPOSE, KOVANICA_COIN_TYPE, safeIndex, 0, 0];
  for (const step of steps) {
    const data = new Uint8Array(37);
    data[0] = 0x00;
    data.set(key, 1);
    new DataView(data.buffer).setUint32(33, step + HARDENED_OFFSET, false);
    digest = hmac(sha512, chainCode, data);
    data.fill(0);
    key.fill(0);
    chainCode.fill(0);
    key = digest.slice(0, 32);
    chainCode = digest.slice(32, 64);
  }
  chainCode.fill(0);
  return key;
}

/** Lowercase / NFKD-normalise / collapse whitespace, without touching crypto. */
export function normalizeMnemonic(phrase: string): string {
  return normalizePhrase(phrase);
}

/**
 * English BIP-39 mnemonic from caller-supplied entropy (16 or 32 bytes). The
 * checksum is computed by the Rust `bip39` crate, so the wordlist is always the
 * canonical one.
 */
export async function entropyToMnemonic(entropy: Uint8Array): Promise<string> {
  await ensureWasmReady();
  return wasm.entropy_to_mnemonic(entropy);
}

/**
 * Generate a fresh 24-word recovery phrase.
 */
export async function createMnemonic(): Promise<string> {
  await ensureWasmReady();
  return wasm.generate_mnemonic(24);
}

/**
 * 64-byte BIP-39 seed (PBKDF2-HMAC-SHA512).
 */
export async function mnemonicToSeed(mnemonic: string, passphrase = ""): Promise<Uint8Array> {
  await ensureWasmReady();
  return wasm.mnemonic_to_seed(normalizePhrase(mnemonic), passphrase);
}

/**
 * 32-byte Ed25519 signing seed derived at canonical BIP-44 path
 * `m/44'/3007'/<index>'/0'/0'`. Secret material — never log or transmit it.
 */
export async function seedFromMnemonic(mnemonic: string, index = 0): Promise<Uint8Array> {
  const seed64 = await mnemonicToSeed(mnemonic, "");
  try {
    return deriveSlip10Bip44Key(seed64, index);
  } finally {
    seed64.fill(0);
  }
}

/**
 * Public key (64 hex chars) for a recovery phrase at `m/44'/3007'/<index>'/0'/0'`.
 * The wallet shows the `kvnc…dag` form of this value; see `hexToKvnc`.
 */
export async function addressFromMnemonic(mnemonic: string, index = 0): Promise<string> {
  const seed = await seedFromMnemonic(mnemonic, index);
  try {
    await ensureWasmReady();
    return wasm.public_key_from_secret_bytes(bytesToHex(seed));
  } finally {
    seed.fill(0);
  }
}

/** Sign a prepare sighash (hex) with the derived key at `m/44'/3007'/<index>'/0'/0'`; 128 hex chars. */
export async function signSighash(
  mnemonic: string,
  index: number,
  sighashHex: string,
): Promise<string> {
  const seed = await seedFromMnemonic(mnemonic, index);
  try {
    await ensureWasmReady();
    return wasm.sign_sighash_with_seed_hex(bytesToHex(seed), sighashHex);
  } finally {
    seed.fill(0);
  }
}

/** Sign a prepare sighash with a raw 32-byte Ed25519 seed (64 hex chars). */
export async function signSighashWithSeedHex(
  seedHex: string,
  sighashHex: string,
): Promise<string> {
  await ensureWasmReady();
  return wasm.sign_sighash_with_seed_hex(seedHex, sighashHex);
}

/**
 * Validate and normalise an imported phrase: 12 or 24 words, wordlist
 * membership (so a typo gets its own message) and valid BIP-39 checksum.
 */
export async function importMnemonic(phrase: string): Promise<string> {
  await ensureWasmReady();
  const normalized = wasm.normalize_mnemonic(phrase);
  const words = normalized.length > 0 ? normalized.split(" ") : [];
  if (words.length !== 12 && words.length !== 24) {
    throw new Error("Your recovery phrase needs 12 or 24 words.");
  }
  const unknown = wasm.mnemonic_unknown_words(normalized);
  if (unknown.length > 0) {
    throw new Error(`"${unknown[0]}" isn't a recovery word — check for a typo.`);
  }
  if (!wasm.mnemonic_is_valid(normalized)) {
    throw new Error(
      "That recovery phrase doesn't look valid — please check for a typo or a wrong word.",
    );
  }
  return normalized;
}
