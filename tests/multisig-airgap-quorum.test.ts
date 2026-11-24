import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { encodeAddress } from "../src/lib/wallet/address";
import {
  MULTISIG_BUNDLE_FORMAT,
  MULTISIG_BUNDLE_VERSION,
  MULTISIG_CHAIN_IDS,
  createSampleMultisigBundleJson,
  evaluateMultisigQuorum,
  parseMultisigBundleJson,
  serializeMultisigBundleJson,
} from "../src/lib/multisig/airgap-quorum";

function makePro21(seedByte: number): string {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) {
    bytes[i] = (seedByte + i * 11) & 0xff;
  }
  return encodeAddress(bytes);
}

function toTestnetPro21(mainnetAddr: string): string {
  return `tknc${mainnetAddr.slice(4)}`;
}

const MULTISIG_ADDR = makePro21(0x01);
const SIGNER_1 = makePro21(0x11);
const SIGNER_2 = makePro21(0x22);
const SIGNER_3 = makePro21(0x33);
const UNKNOWN_SIGNER = makePro21(0x44);

const SIG_1 = `0x${"11".repeat(64)}`;
const SIG_2 = `0x${"22".repeat(64)}`;
const SIG_3 = `0x${"33".repeat(64)}`;
const SIG_UNKNOWN = `0x${"44".repeat(64)}`;

describe("evaluateMultisigQuorum", () => {
  it("reports quorum reached with 100% progress when valid approvals meet threshold", () => {
    const result = evaluateMultisigQuorum({
      signers: [SIGNER_1, SIGNER_2, SIGNER_3],
      approvals: [SIGNER_1, SIGNER_3],
      threshold: 2,
    });

    assert.equal(result.quorumReached, true);
    assert.equal(result.approvedCount, 2);
    assert.equal(result.threshold, 2);
    assert.equal(result.remainingNeeded, 0);
    assert.equal(result.progressPercent, 100);
    assert.deepEqual(result.validApprovals, [SIGNER_1, SIGNER_3]);
    assert.deepEqual(result.pendingSigners, [SIGNER_2]);
    assert.deepEqual(result.unknownApprovals, []);
    assert.deepEqual(result.duplicateApprovals, []);
  });

  it("reports quorum pending with accurate remaining count and progress percentage", () => {
    const result = evaluateMultisigQuorum({
      signers: [SIGNER_1, SIGNER_2, SIGNER_3],
      approvals: [SIGNER_2],
      threshold: 2,
    });

    assert.equal(result.quorumReached, false);
    assert.equal(result.approvedCount, 1);
    assert.equal(result.threshold, 2);
    assert.equal(result.remainingNeeded, 1);
    assert.equal(result.progressPercent, 50);
    assert.deepEqual(result.validApprovals, [SIGNER_2]);
    assert.deepEqual(result.pendingSigners, [SIGNER_1, SIGNER_3]);
    assert.deepEqual(result.unknownApprovals, []);
    assert.deepEqual(result.duplicateApprovals, []);
  });

  it("classifies duplicate and unknown approvers without inflating quorum count", () => {
    const result = evaluateMultisigQuorum({
      signers: [SIGNER_1, SIGNER_2, SIGNER_3],
      approvals: [
        SIGNER_1,
        SIGNER_1,
        toTestnetPro21(SIGNER_1),
        UNKNOWN_SIGNER,
        UNKNOWN_SIGNER,
        "not-a-valid-address",
        "not-a-valid-address",
      ],
      threshold: 2,
    });

    assert.equal(result.quorumReached, false);
    assert.equal(result.approvedCount, 1);
    assert.equal(result.remainingNeeded, 1);
    assert.equal(result.progressPercent, 50);
    assert.deepEqual(result.validApprovals, [SIGNER_1]);
    assert.deepEqual(result.unknownApprovals, [UNKNOWN_SIGNER, "not-a-valid-address"]);
    assert.deepEqual(result.duplicateApprovals, [SIGNER_1, UNKNOWN_SIGNER, "not-a-valid-address"]);
  });

  it("rejects non-PRO-21 signers and invalid thresholds", () => {
    assert.throws(
      () =>
        evaluateMultisigQuorum({
          signers: [`0x${"aa".repeat(32)}`],
          approvals: [],
          threshold: 1,
        }),
      /PRO-21/i,
    );

    assert.throws(
      () =>
        evaluateMultisigQuorum({
          signers: [SIGNER_1, SIGNER_2],
          approvals: [],
          threshold: 3,
        }),
      /threshold/i,
    );
  });
});

describe("parseMultisigBundleJson & serializeMultisigBundleJson", () => {
  it("parses a valid kovanica-multisig-bundle-v1 and round-trips deterministically", () => {
    const raw = JSON.stringify({
      format: MULTISIG_BUNDLE_FORMAT,
      version: MULTISIG_BUNDLE_VERSION,
      chainId: MULTISIG_CHAIN_IDS.MAINNET,
      multisigAddress: MULTISIG_ADDR,
      proposalId: "prop-2026-roundtrip",
      threshold: 2,
      signers: [SIGNER_3, SIGNER_1, SIGNER_2, SIGNER_1],
      approvals: [
        { signer: SIGNER_2, signatureHex: SIG_2, signedAtMs: 1735689660000 },
        { signer: SIGNER_1, signatureHex: SIG_1, signedAtMs: 1735689600000 },
      ],
      payloadHex: "0xdeadbeef",
      description: "Treasury payout",
    });

    const parsed = parseMultisigBundleJson(raw);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;

    assert.equal(parsed.quorum.quorumReached, true);
    assert.equal(parsed.quorum.approvedCount, 2);
    assert.equal(parsed.quorum.progressPercent, 100);
    assert.deepEqual(parsed.bundle.signers, [SIGNER_1, SIGNER_2, SIGNER_3].sort());

    const reserialized = serializeMultisigBundleJson(parsed.bundle, true);
    assert.equal(reserialized, parsed.sanitizedJson);

    const reparsed = parseMultisigBundleJson(reserialized);
    assert.equal(reparsed.ok, true);
    if (!reparsed.ok) return;
    assert.deepEqual(reparsed.bundle, parsed.bundle);
    assert.deepEqual(reparsed.quorum, parsed.quorum);
  });

  it("classifies duplicate and unknown approvers in a valid bundle", () => {
    const raw = JSON.stringify({
      format: MULTISIG_BUNDLE_FORMAT,
      version: MULTISIG_BUNDLE_VERSION,
      chainId: MULTISIG_CHAIN_IDS.MAINNET,
      multisigAddress: MULTISIG_ADDR,
      proposalId: "prop-warnings",
      threshold: 2,
      signers: [SIGNER_1, SIGNER_2, SIGNER_3],
      approvals: [
        { signer: SIGNER_1, signatureHex: SIG_1 },
        { signer: SIGNER_1, signatureHex: SIG_3 },
        { signer: UNKNOWN_SIGNER, signatureHex: SIG_UNKNOWN },
      ],
      description: "Proposal with duplicate & unknown approvals",
    });

    const parsed = parseMultisigBundleJson(raw);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;

    assert.equal(parsed.quorum.quorumReached, false);
    assert.equal(parsed.quorum.approvedCount, 1);
    assert.equal(parsed.quorum.remainingNeeded, 1);
    assert.deepEqual(parsed.quorum.validApprovals, [SIGNER_1]);
    assert.deepEqual(parsed.quorum.duplicateApprovals, [SIGNER_1]);
    assert.deepEqual(parsed.quorum.unknownApprovals, [UNKNOWN_SIGNER]);
  });

  it("enforces PRO-21 chain prefix rules (tknc allowed on Testnet chain 2 only)", () => {
    const testnetBundle = {
      format: MULTISIG_BUNDLE_FORMAT,
      version: MULTISIG_BUNDLE_VERSION,
      chainId: MULTISIG_CHAIN_IDS.TESTNET,
      multisigAddress: toTestnetPro21(MULTISIG_ADDR),
      proposalId: "prop-testnet",
      threshold: 1,
      signers: [toTestnetPro21(SIGNER_1), toTestnetPro21(SIGNER_2)],
      approvals: [{ signer: toTestnetPro21(SIGNER_1), signatureHex: SIG_1 }],
      description: "Testnet multisig",
    };

    const okTestnet = parseMultisigBundleJson(JSON.stringify(testnetBundle));
    assert.equal(okTestnet.ok, true);

    const badMainnet = parseMultisigBundleJson(
      JSON.stringify({ ...testnetBundle, chainId: MULTISIG_CHAIN_IDS.MAINNET }),
    );
    assert.equal(badMainnet.ok, false);
    if (!badMainnet.ok) {
      assert.match(badMainnet.error, /Testnet-prefixed/i);
    }
  });

  it("strictly rejects any secret, privateKey, mnemonic, or seed fields at any depth", () => {
    const base = {
      format: MULTISIG_BUNDLE_FORMAT,
      version: MULTISIG_BUNDLE_VERSION,
      chainId: MULTISIG_CHAIN_IDS.MAINNET,
      multisigAddress: MULTISIG_ADDR,
      proposalId: "prop-secret-check",
      threshold: 1,
      signers: [SIGNER_1],
      approvals: [{ signer: SIGNER_1, signatureHex: SIG_1 }],
      description: "Should fail when secrets are present",
    };

    const secretPayloads = [
      { ...base, privateKey: "0xdeadbeef" },
      { ...base, mnemonic: "abandon abandon abandon" },
      { ...base, seed_phrase: "word1 word2" },
      { ...base, secret: "topsecret" },
      {
        ...base,
        approvals: [{ signer: SIGNER_1, signatureHex: SIG_1, signingKey: "0x1234" }],
      },
      { ...base, meta: { nested: { keystore: "{}" } } },
    ];

    for (const payload of secretPayloads) {
      const parsed = parseMultisigBundleJson(JSON.stringify(payload));
      assert.equal(parsed.ok, false);
      if (!parsed.ok) {
        assert.match(parsed.error, /Forbidden secret\/private key field/i);
      }
    }
  });

  it("rejects malformed JSON, unsupported format/version, and missing payload/description", () => {
    assert.equal(parseMultisigBundleJson("{not json").ok, false);
    assert.equal(
      parseMultisigBundleJson(
        JSON.stringify({
          format: "other-format-v1",
          version: 1,
          chainId: 1,
          multisigAddress: MULTISIG_ADDR,
          proposalId: "p1",
          threshold: 1,
          signers: [SIGNER_1],
          approvals: [],
          description: "x",
        }),
      ).ok,
      false,
    );
    assert.equal(
      parseMultisigBundleJson(
        JSON.stringify({
          format: MULTISIG_BUNDLE_FORMAT,
          version: 1,
          chainId: 1,
          multisigAddress: MULTISIG_ADDR,
          proposalId: "p1",
          threshold: 1,
          signers: [SIGNER_1],
          approvals: [],
        }),
      ).ok,
      false,
    );
  });

  it("produces valid sample bundles for both pending and quorum variants", () => {
    const pending = parseMultisigBundleJson(createSampleMultisigBundleJson("pending"));
    assert.equal(pending.ok, true);
    if (pending.ok) {
      assert.equal(pending.quorum.quorumReached, false);
      assert.equal(pending.quorum.approvedCount, 1);
      assert.equal(pending.quorum.threshold, 2);
    }

    const quorum = parseMultisigBundleJson(createSampleMultisigBundleJson("quorum"));
    assert.equal(quorum.ok, true);
    if (quorum.ok) {
      assert.equal(quorum.quorum.quorumReached, true);
      assert.equal(quorum.quorum.approvedCount, 2);
      assert.equal(quorum.quorum.threshold, 2);
    }
  });
});
