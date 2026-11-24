import { inspectExplorerAddress } from "@/lib/explorer/address-inspect";
import { encodeAddress } from "@/lib/wallet/address";

export const MULTISIG_BUNDLE_FORMAT = "kovanica-multisig-bundle-v1" as const;
export const MULTISIG_BUNDLE_VERSION = 1 as const;

export const MULTISIG_CHAIN_IDS = {
  MAINNET: 1,
  TESTNET: 2,
  DEVNET: 3,
} as const;

export type MultisigBundleChainId =
  | typeof MULTISIG_CHAIN_IDS.MAINNET
  | typeof MULTISIG_CHAIN_IDS.TESTNET
  | typeof MULTISIG_CHAIN_IDS.DEVNET;

export interface MultisigQuorumInput {
  signers: readonly string[];
  approvals: readonly string[];
  threshold: number;
}

export interface MultisigQuorumResult {
  quorumReached: boolean;
  approvedCount: number;
  threshold: number;
  remainingNeeded: number;
  progressPercent: number;
  uniqueSigners: string[];
  validApprovals: string[];
  pendingSigners: string[];
  unknownApprovals: string[];
  duplicateApprovals: string[];
}

export interface MultisigApprovalEntry {
  /** Normalized PRO-21 signer address. */
  signer: string;
  /** Normalized lowercase `0x`-prefixed 64-byte Ed25519 signature hex. */
  signatureHex: string;
  /** Optional Unix timestamp in milliseconds when the approval was signed. */
  signedAtMs?: number;
}

export interface MultisigProposalBundle {
  format: typeof MULTISIG_BUNDLE_FORMAT;
  version: typeof MULTISIG_BUNDLE_VERSION;
  chainId: MultisigBundleChainId;
  multisigAddress: string;
  proposalId: string;
  threshold: number;
  signers: string[];
  approvals: MultisigApprovalEntry[];
  payloadHex?: string;
  description?: string;
}

export type ParseMultisigBundleResult =
  | {
      ok: true;
      bundle: MultisigProposalBundle;
      quorum: MultisigQuorumResult;
      sanitizedJson: string;
    }
  | {
      ok: false;
      error: string;
      field?: string;
    };

class MultisigBundleValidationError extends Error {
  readonly field?: string;

  constructor(message: string, field?: string) {
    super(message);
    this.name = "MultisigBundleValidationError";
    this.field = field;
  }
}

const VALID_MULTISIG_CHAIN_IDS: ReadonlySet<number> = new Set<number>([
  MULTISIG_CHAIN_IDS.MAINNET,
  MULTISIG_CHAIN_IDS.TESTNET,
  MULTISIG_CHAIN_IDS.DEVNET,
]);

const FORBIDDEN_SECRET_FIELD_PATTERNS: readonly RegExp[] = [
  /^privatekey$/i,
  /^privkey$/i,
  /^rawprivatekey$/i,
  /^secretkey$/i,
  /^secret$/i,
  /^mnemonic$/i,
  /^seed$/i,
  /^seedphrase$/i,
  /^seedhex$/i,
  /^passphrase$/i,
  /^password$/i,
  /^keystore$/i,
  /^xprv$/i,
  /^signingkey$/i,
  /^spendingkey$/i,
  /^masterkey$/i,
  /^sk$/i,
];

function isForbiddenSecretKeyName(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[-_\s]/g, "");
  return FORBIDDEN_SECRET_FIELD_PATTERNS.some((pattern) => pattern.test(normalized));
}

function assertNoSecretFields(value: unknown, path = "bundle"): void {
  if (value === null || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      assertNoSecretFields(value[i], `${path}[${i}]`);
    }
    return;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (isForbiddenSecretKeyName(key)) {
      throw new MultisigBundleValidationError(
        `Forbidden secret/private key field '${key}' at ${path}.${key} is not permitted in air-gapped multisig bundles`,
        `${path}.${key}`,
      );
    }
    assertNoSecretFields(nested, `${path}.${key}`);
  }
}

interface ValidatedPro21Address {
  canonical: string;
  payloadKey: string;
}

function validatePro21Address(
  address: unknown,
  field: string,
  expectedChainId?: MultisigBundleChainId,
): ValidatedPro21Address {
  if (typeof address !== "string") {
    throw new MultisigBundleValidationError(
      `Invalid ${field}: expected a PRO-21 address string`,
      field,
    );
  }
  const inspected = inspectExplorerAddress(address);
  if (
    !inspected.valid ||
    (inspected.format !== "pro21-mainnet" && inspected.format !== "pro21-testnet") ||
    !inspected.canonicalMainnet ||
    !inspected.canonicalTestnet
  ) {
    throw new MultisigBundleValidationError(
      `Invalid PRO-21 address in ${field}: ${inspected.error ?? "expected canonical PRO-21 address"}`,
      field,
    );
  }

  if (
    expectedChainId !== undefined &&
    inspected.format === "pro21-testnet" &&
    expectedChainId !== MULTISIG_CHAIN_IDS.TESTNET
  ) {
    throw new MultisigBundleValidationError(
      `Invalid PRO-21 address in ${field}: Testnet-prefixed (tknc...dag) addresses are only allowed on Testnet (chain 2), not chain ${expectedChainId}`,
      field,
    );
  }

  const canonical =
    inspected.format === "pro21-testnet"
      ? inspected.canonicalTestnet
      : inspected.canonicalMainnet;

  return {
    canonical,
    payloadKey: inspected.canonicalMainnet,
  };
}

function validateMultisigChainId(chainId: unknown): MultisigBundleChainId {
  if (
    typeof chainId !== "number" ||
    !Number.isSafeInteger(chainId) ||
    !VALID_MULTISIG_CHAIN_IDS.has(chainId)
  ) {
    throw new MultisigBundleValidationError(
      `Invalid multisig bundle chainId: expected 1 (Mainnet), 2 (Testnet), or 3 (Devnet), got ${String(chainId)}`,
      "chainId",
    );
  }
  return chainId as MultisigBundleChainId;
}

function validateThreshold(threshold: unknown, signerCount: number): number {
  if (
    typeof threshold !== "number" ||
    !Number.isSafeInteger(threshold) ||
    threshold < 1 ||
    threshold > signerCount
  ) {
    throw new MultisigBundleValidationError(
      `Invalid multisig threshold: expected integer in range 1..${signerCount}, got ${String(threshold)}`,
      "threshold",
    );
  }
  return threshold;
}

function validateSignatureHex(signatureHex: unknown, field: string): string {
  if (typeof signatureHex !== "string" || !/^0x[0-9a-f]{128}$/.test(signatureHex)) {
    throw new MultisigBundleValidationError(
      `Invalid ${field}: expected lowercase 0x-prefixed 64-byte (128 hex chars) signature`,
      field,
    );
  }
  return signatureHex;
}

function validatePayloadHex(payloadHex: unknown): string | undefined {
  if (payloadHex === undefined) {
    return undefined;
  }
  if (
    typeof payloadHex !== "string" ||
    !/^0x[0-9a-f]+$/.test(payloadHex) ||
    payloadHex.length % 2 !== 0
  ) {
    throw new MultisigBundleValidationError(
      "Invalid payloadHex: expected lowercase 0x-prefixed even-length hex",
      "payloadHex",
    );
  }
  return payloadHex;
}

function validateDescription(description: unknown): string | undefined {
  if (description === undefined) {
    return undefined;
  }
  if (typeof description !== "string" || description.trim().length === 0) {
    throw new MultisigBundleValidationError(
      "Invalid description: expected a non-empty string",
      "description",
    );
  }
  return description.trim();
}

function validateSignedAtMs(signedAtMs: unknown, field: string): number | undefined {
  if (signedAtMs === undefined) {
    return undefined;
  }
  if (typeof signedAtMs !== "number" || !Number.isSafeInteger(signedAtMs) || signedAtMs < 0) {
    throw new MultisigBundleValidationError(
      `Invalid ${field}: expected a non-negative safe integer timestamp in ms`,
      field,
    );
  }
  return signedAtMs;
}

function buildValidatedBundle(raw: Record<string, unknown>): MultisigProposalBundle {
  assertNoSecretFields(raw);

  if (raw.format !== MULTISIG_BUNDLE_FORMAT) {
    throw new MultisigBundleValidationError(
      `Unsupported multisig bundle format: ${String(raw.format)} (expected '${MULTISIG_BUNDLE_FORMAT}')`,
      "format",
    );
  }
  if (raw.version !== MULTISIG_BUNDLE_VERSION) {
    throw new MultisigBundleValidationError(
      `Unsupported multisig bundle version: ${String(raw.version)} (expected ${MULTISIG_BUNDLE_VERSION})`,
      "version",
    );
  }

  const chainId = validateMultisigChainId(raw.chainId);
  const multisigAddress = validatePro21Address(
    raw.multisigAddress,
    "multisigAddress",
    chainId,
  ).canonical;

  if (typeof raw.proposalId !== "string" || raw.proposalId.trim().length === 0) {
    throw new MultisigBundleValidationError(
      "Invalid proposalId: expected a non-empty string",
      "proposalId",
    );
  }
  const proposalId = raw.proposalId.trim();

  if (!Array.isArray(raw.signers)) {
    throw new MultisigBundleValidationError(
      "Invalid signers: expected an array of PRO-21 addresses",
      "signers",
    );
  }

  const signerByPayloadKey = new Map<string, string>();
  for (let i = 0; i < raw.signers.length; i += 1) {
    const validated = validatePro21Address(raw.signers[i], `signers[${i}]`, chainId);
    if (!signerByPayloadKey.has(validated.payloadKey)) {
      signerByPayloadKey.set(validated.payloadKey, validated.canonical);
    }
  }
  const signers = Array.from(signerByPayloadKey.values()).sort();
  if (signers.length === 0) {
    throw new MultisigBundleValidationError(
      "Multisig proposal bundle must include at least one valid PRO-21 signer",
      "signers",
    );
  }

  const threshold = validateThreshold(raw.threshold, signers.length);

  if (!Array.isArray(raw.approvals)) {
    throw new MultisigBundleValidationError(
      "Invalid approvals: expected an array of approval entries",
      "approvals",
    );
  }

  const approvals: MultisigApprovalEntry[] = [];
  for (let i = 0; i < raw.approvals.length; i += 1) {
    const entry = raw.approvals[i];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new MultisigBundleValidationError(
        `Invalid approvals[${i}]: expected an object`,
        `approvals[${i}]`,
      );
    }
    const entryObj = entry as Record<string, unknown>;
    const signer = validatePro21Address(
      entryObj.signer,
      `approvals[${i}].signer`,
      chainId,
    ).canonical;
    const signatureHex = validateSignatureHex(
      entryObj.signatureHex,
      `approvals[${i}].signatureHex`,
    );
    const signedAtMs = validateSignedAtMs(entryObj.signedAtMs, `approvals[${i}].signedAtMs`);
    approvals.push(
      signedAtMs !== undefined ? { signer, signatureHex, signedAtMs } : { signer, signatureHex },
    );
  }

  approvals.sort((a, b) => {
    if (a.signer !== b.signer) return a.signer < b.signer ? -1 : 1;
    if (a.signatureHex !== b.signatureHex) {
      return a.signatureHex < b.signatureHex ? -1 : 1;
    }
    return (a.signedAtMs ?? -1) - (b.signedAtMs ?? -1);
  });

  const payloadHex = validatePayloadHex(raw.payloadHex);
  const description = validateDescription(raw.description);
  if (payloadHex === undefined && description === undefined) {
    throw new MultisigBundleValidationError(
      "Multisig proposal bundle must include payloadHex or description",
      "payloadHex",
    );
  }

  const bundle: MultisigProposalBundle = {
    format: MULTISIG_BUNDLE_FORMAT,
    version: MULTISIG_BUNDLE_VERSION,
    chainId,
    multisigAddress,
    proposalId,
    threshold,
    signers,
    approvals,
  };
  if (payloadHex !== undefined) {
    bundle.payloadHex = payloadHex;
  }
  if (description !== undefined) {
    bundle.description = description;
  }

  return bundle;
}

/**
 * Validates a multisig signer set and threshold, deduplicates normalized PRO-21 signers
 * and approvals, and computes quorum status, progress percentage, and valid/pending/unknown/duplicate
 * approval classifications matching `kovanica-sdk`.
 */
export function evaluateMultisigQuorum(input: MultisigQuorumInput): MultisigQuorumResult {
  if (!input || typeof input !== "object") {
    throw new MultisigBundleValidationError("Multisig quorum input must be an object");
  }
  if (!Array.isArray(input.signers)) {
    throw new MultisigBundleValidationError(
      "Invalid signers: expected an array of PRO-21 addresses",
      "signers",
    );
  }
  if (!Array.isArray(input.approvals)) {
    throw new MultisigBundleValidationError(
      "Invalid approvals: expected an array of approver addresses",
      "approvals",
    );
  }

  const signerByPayloadKey = new Map<string, string>();
  const uniqueSigners: string[] = [];

  for (let i = 0; i < input.signers.length; i += 1) {
    const validated = validatePro21Address(input.signers[i], `signers[${i}]`);
    if (!signerByPayloadKey.has(validated.payloadKey)) {
      signerByPayloadKey.set(validated.payloadKey, validated.canonical);
      uniqueSigners.push(validated.canonical);
    }
  }

  if (uniqueSigners.length === 0) {
    throw new MultisigBundleValidationError(
      "Multisig signers list must contain at least one valid PRO-21 address",
      "signers",
    );
  }

  const threshold = validateThreshold(input.threshold, uniqueSigners.length);

  const validApprovals: string[] = [];
  const unknownApprovals: string[] = [];
  const duplicateApprovals: string[] = [];

  const seenValidKeys = new Set<string>();
  const seenUnknownKeys = new Set<string>();
  const seenDuplicateKeys = new Set<string>();

  for (let i = 0; i < input.approvals.length; i += 1) {
    const rawApproval = input.approvals[i];
    if (typeof rawApproval !== "string") {
      throw new MultisigBundleValidationError(
        `Invalid approvals[${i}]: expected an address string`,
        `approvals[${i}]`,
      );
    }
    const inspected = inspectExplorerAddress(rawApproval);
    const isPro21 =
      inspected.valid &&
      (inspected.format === "pro21-mainnet" || inspected.format === "pro21-testnet") &&
      inspected.canonicalMainnet !== undefined &&
      inspected.canonicalTestnet !== undefined;

    if (isPro21) {
      const payloadKey = inspected.canonicalMainnet!;
      const matchedSigner = signerByPayloadKey.get(payloadKey);
      if (matchedSigner !== undefined) {
        if (seenValidKeys.has(payloadKey)) {
          if (!seenDuplicateKeys.has(payloadKey)) {
            seenDuplicateKeys.add(payloadKey);
            duplicateApprovals.push(matchedSigner);
          }
        } else {
          seenValidKeys.add(payloadKey);
          validApprovals.push(matchedSigner);
        }
      } else {
        const normalizedUnknown =
          inspected.format === "pro21-testnet"
            ? inspected.canonicalTestnet!
            : inspected.canonicalMainnet!;
        if (seenUnknownKeys.has(payloadKey)) {
          if (!seenDuplicateKeys.has(payloadKey)) {
            seenDuplicateKeys.add(payloadKey);
            duplicateApprovals.push(normalizedUnknown);
          }
        } else {
          seenUnknownKeys.add(payloadKey);
          unknownApprovals.push(normalizedUnknown);
        }
      }
    } else {
      const trimmedUnknown = rawApproval.trim();
      const unknownKey = `raw:${trimmedUnknown}`;
      if (seenUnknownKeys.has(unknownKey)) {
        if (!seenDuplicateKeys.has(unknownKey)) {
          seenDuplicateKeys.add(unknownKey);
          duplicateApprovals.push(trimmedUnknown);
        }
      } else {
        seenUnknownKeys.add(unknownKey);
        unknownApprovals.push(trimmedUnknown);
      }
    }
  }

  const approvedCount = validApprovals.length;
  const quorumReached = approvedCount >= threshold;
  const remainingNeeded = Math.max(0, threshold - approvedCount);
  const progressPercent = Math.min(100, Math.round((approvedCount / threshold) * 100));
  const validSet = new Set(validApprovals);
  const pendingSigners = uniqueSigners.filter((signer) => !validSet.has(signer));

  return {
    quorumReached,
    approvedCount,
    threshold,
    remainingNeeded,
    progressPercent,
    uniqueSigners,
    validApprovals,
    pendingSigners,
    unknownApprovals,
    duplicateApprovals,
  };
}

/**
 * Serializes a validated `kovanica-multisig-bundle-v1` into deterministic, sanitized JSON
 * containing strictly public proposal & approval fields (zero secret fields).
 */
export function serializeMultisigBundleJson(
  bundle: MultisigProposalBundle,
  pretty = true,
): string {
  const sanitized = buildValidatedBundle(bundle as unknown as Record<string, unknown>);
  return JSON.stringify(sanitized, null, pretty ? 2 : undefined);
}

/**
 * Parses and strictly validates a `kovanica-multisig-bundle-v1` JSON string,
 * rejecting any embedded secret/private key fields, invalid PRO-21 addresses,
 * or malformed signatures, and computes quorum status. Never throws.
 */
export function parseMultisigBundleJson(rawJson: string): ParseMultisigBundleResult {
  if (typeof rawJson !== "string") {
    return { ok: false, error: "Encoded multisig proposal bundle must be a string" };
  }
  const trimmed = rawJson.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "Paste a kovanica-multisig-bundle-v1 JSON payload to inspect." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, error: "Encoded multisig proposal bundle is not valid JSON" };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "Encoded multisig proposal bundle JSON must be an object" };
  }

  try {
    const bundle = buildValidatedBundle(parsed as Record<string, unknown>);
    const quorum = evaluateMultisigQuorum({
      signers: bundle.signers,
      approvals: bundle.approvals.map((entry) => entry.signer),
      threshold: bundle.threshold,
    });
    const sanitizedJson = JSON.stringify(bundle, null, 2);
    return { ok: true, bundle, quorum, sanitizedJson };
  } catch (err) {
    if (err instanceof MultisigBundleValidationError) {
      return { ok: false, error: err.message, field: err.field };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to validate multisig bundle",
    };
  }
}

export function getMultisigChainLabel(chainId: MultisigBundleChainId): string {
  switch (chainId) {
    case MULTISIG_CHAIN_IDS.MAINNET:
      return "Mainnet (Chain 1)";
    case MULTISIG_CHAIN_IDS.TESTNET:
      return "Testnet (Chain 2)";
    case MULTISIG_CHAIN_IDS.DEVNET:
      return "Devnet (Chain 3)";
  }
}

function deterministicPro21(seedByte: number): string {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) {
    bytes[i] = (seedByte + i * 7) & 0xff;
  }
  return encodeAddress(bytes);
}

/**
 * Generates a deterministic, valid `kovanica-multisig-bundle-v1` sample JSON
 * for offline inspection previews and tests.
 */
export function createSampleMultisigBundleJson(
  variant: "pending" | "quorum" = "pending",
): string {
  const multisigAddress = deterministicPro21(0x10);
  const signerA = deterministicPro21(0x21);
  const signerB = deterministicPro21(0x32);
  const signerC = deterministicPro21(0x43);

  const approvals: MultisigApprovalEntry[] = [
    {
      signer: signerA,
      signatureHex: `0x${"a1".repeat(64)}`,
      signedAtMs: 1735689600000,
    },
  ];

  if (variant === "quorum") {
    approvals.push({
      signer: signerB,
      signatureHex: `0x${"b2".repeat(64)}`,
      signedAtMs: 1735689660000,
    });
  }

  return serializeMultisigBundleJson(
    {
      format: MULTISIG_BUNDLE_FORMAT,
      version: MULTISIG_BUNDLE_VERSION,
      chainId: MULTISIG_CHAIN_IDS.MAINNET,
      multisigAddress,
      proposalId: variant === "quorum" ? "prop-treasury-2026-02" : "prop-treasury-2026-01",
      threshold: 2,
      signers: [signerA, signerB, signerC],
      approvals,
      payloadHex: "0xdeadbeef01020304",
      description:
        variant === "quorum"
          ? "Treasury disbursement 2-of-3 (quorum satisfied)"
          : "Treasury disbursement 2-of-3 (awaiting 1 more air-gapped approval)",
    },
    true,
  );
}
