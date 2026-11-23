import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildContractInspectorUrl,
  isDeployedContractAccount,
  resolveContractCodeBytes,
} from "../src/components/explorer/address-contract-banner";
import { parseContractInspectorDeepLink } from "../src/lib/contracts/dry-run";
import { hexToKvnc } from "../src/lib/wallet/address";

const SAMPLE_CONTRACT_HEX =
  "0000000000000000000000000000000000000000000000000000000000000001";
const SAMPLE_CONTRACT_CANONICAL = hexToKvnc(SAMPLE_CONTRACT_HEX);
const OTHER_EOA_HEX =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER_EOA_CANONICAL = hexToKvnc(OTHER_EOA_HEX);

describe("isDeployedContractAccount", () => {
  it("returns true when codeBytes > 0", () => {
    assert.equal(
      isDeployedContractAccount({
        address: SAMPLE_CONTRACT_CANONICAL,
        codeBytes: 4096,
      }),
      true,
    );
    assert.equal(
      isDeployedContractAccount({
        address: SAMPLE_CONTRACT_HEX,
        codeBytes: 1,
      }),
      true,
    );
  });

  it("returns false when codeBytes is 0 even if address is in knownContracts", () => {
    assert.equal(
      isDeployedContractAccount({
        address: SAMPLE_CONTRACT_CANONICAL,
        codeBytes: 0,
        knownContracts: [SAMPLE_CONTRACT_CANONICAL],
      }),
      false,
    );
  });

  it("detects non-empty WASM bytecode from codeHex and rejects empty 0x", () => {
    assert.equal(
      isDeployedContractAccount({
        address: SAMPLE_CONTRACT_CANONICAL,
        codeHex: "0x0061736d01000000",
      }),
      true,
    );
    assert.equal(
      isDeployedContractAccount({
        address: SAMPLE_CONTRACT_CANONICAL,
        codeHex: "0x",
      }),
      false,
    );
    assert.equal(
      isDeployedContractAccount({
        address: SAMPLE_CONTRACT_CANONICAL,
        codeHex: "",
      }),
      false,
    );
  });

  it("matches knownContracts across canonical kvnc…dag and 64-char hex representations", () => {
    assert.equal(
      isDeployedContractAccount({
        address: SAMPLE_CONTRACT_HEX,
        knownContracts: [SAMPLE_CONTRACT_CANONICAL],
      }),
      true,
    );
    assert.equal(
      isDeployedContractAccount({
        address: SAMPLE_CONTRACT_CANONICAL,
        knownContracts: new Set([`0x${SAMPLE_CONTRACT_HEX}`]),
      }),
      true,
    );
    assert.equal(
      isDeployedContractAccount({
        address: OTHER_EOA_CANONICAL,
        knownContracts: [SAMPLE_CONTRACT_CANONICAL],
      }),
      false,
    );
  });

  it("respects explicit isContract flag when codeBytes is unknown", () => {
    assert.equal(
      isDeployedContractAccount({
        address: SAMPLE_CONTRACT_CANONICAL,
        isContract: true,
      }),
      true,
    );
    assert.equal(
      isDeployedContractAccount({
        address: OTHER_EOA_CANONICAL,
        isContract: false,
      }),
      false,
    );
  });

  it("returns false for null, undefined, or plain EOA info", () => {
    assert.equal(isDeployedContractAccount(null), false);
    assert.equal(isDeployedContractAccount(undefined), false);
    assert.equal(isDeployedContractAccount({}), false);
    assert.equal(
      isDeployedContractAccount({
        address: OTHER_EOA_CANONICAL,
        codeBytes: null,
      }),
      false,
    );
  });
});

describe("resolveContractCodeBytes", () => {
  it("resolves numeric codeBytes and hex code length accurately", () => {
    assert.equal(resolveContractCodeBytes({ codeBytes: 2048 }), 2048);
    assert.equal(resolveContractCodeBytes({ codeBytes: 0 }), 0);
    assert.equal(resolveContractCodeBytes({ codeHex: "0x0061736d" }), 4);
    assert.equal(resolveContractCodeBytes({ codeHex: "0x" }), 0);
    assert.equal(resolveContractCodeBytes({ codeHex: "not-hex" }), null);
    assert.equal(resolveContractCodeBytes(null), null);
  });
});

describe("buildContractInspectorUrl", () => {
  it("builds a canonical deep-link URL from a kvnc…dag address", () => {
    const url = buildContractInspectorUrl(SAMPLE_CONTRACT_CANONICAL);
    assert.equal(
      url,
      `/explorer?tab=contracts&contract=${SAMPLE_CONTRACT_CANONICAL}`,
    );

    const parsed = parseContractInspectorDeepLink(url.split("?")[1] ?? "");
    assert.equal(parsed.isContractsTab, true);
    assert.equal(parsed.contractAddress, SAMPLE_CONTRACT_CANONICAL);
    assert.equal(parsed.presetId, null);
  });

  it("canonicalizes 32-byte hex addresses (with or without 0x) into kvnc…dag", () => {
    const fromHex = buildContractInspectorUrl(SAMPLE_CONTRACT_HEX);
    const fromPrefixedHex = buildContractInspectorUrl(`0x${SAMPLE_CONTRACT_HEX}`);
    const expected = `/explorer?tab=contracts&contract=${SAMPLE_CONTRACT_CANONICAL}`;
    assert.equal(fromHex, expected);
    assert.equal(fromPrefixedHex, expected);
  });

  it("includes preset query param when a valid preset is provided", () => {
    const url = buildContractInspectorUrl(SAMPLE_CONTRACT_CANONICAL, "token_transfer");
    assert.equal(
      url,
      `/explorer?tab=contracts&contract=${SAMPLE_CONTRACT_CANONICAL}&preset=token_transfer`,
    );

    const parsed = parseContractInspectorDeepLink(url.split("?")[1] ?? "");
    assert.equal(parsed.isContractsTab, true);
    assert.equal(parsed.contractAddress, SAMPLE_CONTRACT_CANONICAL);
    assert.equal(parsed.presetId, "token_transfer");
  });

  it("ignores invalid presets gracefully", () => {
    const url = buildContractInspectorUrl(
      SAMPLE_CONTRACT_CANONICAL,
      "nonexistent_preset" as unknown as "name_resolve",
    );
    assert.equal(
      url,
      `/explorer?tab=contracts&contract=${SAMPLE_CONTRACT_CANONICAL}`,
    );
  });
});
