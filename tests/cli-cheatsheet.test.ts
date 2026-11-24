import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CLI_COMMANDS,
  CLI_NETWORK_SPECS,
  EXAMPLE_AIRGAP_ENVELOPE,
  EXAMPLE_KEYFILE_PATH,
  EXAMPLE_RAW_TX_HEX,
  buildCliCommand,
  buildKeyInspectCommand,
  buildNodeDoctorCommand,
  buildRpcProbeCommand,
  buildSnapshotVerifyCommand,
  buildTxDecodeCommand,
  buildTxEnvelopeCommand,
  shellQuote,
} from "../src/lib/docs/cli-cheatsheet";

describe("CLI Cheat-Sheet — canonical network specs & metadata", () => {
  it("defines canonical chain IDs and frozen network tags", () => {
    assert.equal(CLI_NETWORK_SPECS.mainnet.chainId, 1);
    assert.equal(CLI_NETWORK_SPECS.mainnet.networkTag, "1-f35df34c92001436");
    assert.equal(CLI_NETWORK_SPECS.testnet.chainId, 2);
    assert.equal(CLI_NETWORK_SPECS.testnet.networkTag, "2-24cdb5fadd98b207");
    assert.equal(CLI_NETWORK_SPECS.devnet.chainId, 3);
    assert.equal(CLI_NETWORK_SPECS.devnet.networkTag, null);
  });

  it("exposes all 5 core CLI commands plus key inspect", () => {
    const ids = CLI_COMMANDS.map((c) => c.id);
    assert.deepEqual(ids, [
      "node-doctor",
      "rpc-probe",
      "snapshot-verify",
      "tx-decode",
      "tx-envelope",
      "key-inspect",
    ]);
  });
});

describe("CLI Cheat-Sheet — node doctor", () => {
  it("builds testnet node doctor command with expected chain ID and optional JSON/Stratum", () => {
    const res = buildNodeDoctorCommand({
      network: "testnet",
      rpcUrl: "https://rpc-testnet.kovanica.online",
      stratumHealthUrl: "http://127.0.0.1:9100/health",
      json: true,
    });
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.chainId, 2);
    assert.equal(res.networkTag, "2-24cdb5fadd98b207");
    assert.equal(
      res.command,
      "kovanica node doctor --rpc-url https://rpc-testnet.kovanica.online --expected-chain-id 2 --stratum-health-url http://127.0.0.1:9100/health --json",
    );
  });

  it("omits --expected-chain-id when includeExpectedChainId is false", () => {
    const res = buildNodeDoctorCommand({
      network: "mainnet",
      rpcUrl: "http://127.0.0.1:8545",
      includeExpectedChainId: false,
      json: false,
    });
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.command, "kovanica node doctor --rpc-url http://127.0.0.1:8545");
  });

  it("rejects non-HTTP schemes and shell injection in RPC or Stratum URLs", () => {
    const badScheme = buildNodeDoctorCommand({
      network: "testnet",
      rpcUrl: "ftp://rpc-testnet.kovanica.online",
    });
    assert.equal(badScheme.ok, false);

    const injected = buildNodeDoctorCommand({
      network: "testnet",
      rpcUrl: "https://rpc-testnet.kovanica.online;rm -rf /",
    });
    assert.equal(injected.ok, false);

    const badStratum = buildNodeDoctorCommand({
      network: "devnet",
      rpcUrl: "http://127.0.0.1:8545",
      stratumHealthUrl: "http://127.0.0.1:9100/health$(whoami)",
    });
    assert.equal(badStratum.ok, false);
  });
});

describe("CLI Cheat-Sheet — rpc probe", () => {
  it("builds rpc probe command across presets with custom timeout and --json", () => {
    const res = buildRpcProbeCommand({
      network: "devnet",
      rpcUrl: "http://127.0.0.1:8545",
      timeoutSecs: 15,
      json: true,
    });
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.chainId, 3);
    assert.equal(
      res.command,
      "kovanica rpc probe http://127.0.0.1:8545 --expected-chain-id 3 --timeout-secs 15 --json",
    );
  });

  it("omits --timeout-secs when set to the CLI default (10)", () => {
    const res = buildRpcProbeCommand({
      network: "mainnet",
      rpcUrl: "http://127.0.0.1:8545",
      timeoutSecs: 10,
    });
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(
      res.command,
      "kovanica rpc probe http://127.0.0.1:8545 --expected-chain-id 1",
    );
  });

  it("rejects invalid timeouts", () => {
    assert.equal(
      buildRpcProbeCommand({
        network: "testnet",
        rpcUrl: "https://rpc-testnet.kovanica.online",
        timeoutSecs: 0,
      }).ok,
      false,
    );
    assert.equal(
      buildRpcProbeCommand({
        network: "testnet",
        rpcUrl: "https://rpc-testnet.kovanica.online",
        timeoutSecs: 301,
      }).ok,
      false,
    );
    assert.equal(
      buildRpcProbeCommand({
        network: "testnet",
        rpcUrl: "https://rpc-testnet.kovanica.online",
        timeoutSecs: 2.5,
      }).ok,
      false,
    );
  });
});

describe("CLI Cheat-Sheet — snapshot verify", () => {
  it("builds snapshot verify command and safely single-quotes paths with spaces", () => {
    const res = buildSnapshotVerifyCommand({
      network: "testnet",
      snapshotPath: "./my snapshots/testnet/manifest.json",
      json: true,
    });
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(
      res.command,
      "kovanica snapshot verify './my snapshots/testnet/manifest.json' --expected-chain-id 2 --json",
    );
  });

  it("rejects empty paths, control characters, and shell metacharacters", () => {
    assert.equal(
      buildSnapshotVerifyCommand({ network: "mainnet", snapshotPath: "   " }).ok,
      false,
    );
    assert.equal(
      buildSnapshotVerifyCommand({
        network: "mainnet",
        snapshotPath: "./snapshots/manifest.json\nrm -rf /",
      }).ok,
      false,
    );
    assert.equal(
      buildSnapshotVerifyCommand({
        network: "mainnet",
        snapshotPath: "./snapshots/`id`/manifest.json",
      }).ok,
      false,
    );
  });
});

describe("CLI Cheat-Sheet — tx decode", () => {
  it("normalizes hex case and includes --chain-id and --json", () => {
    const res = buildTxDecodeCommand({
      network: "mainnet",
      rawTxHex: "0XABCDEF01",
      json: true,
    });
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.command, "kovanica tx decode 0xabcdef01 --chain-id 1 --json");
  });

  it("rejects odd-length or non-hex payloads", () => {
    assert.equal(
      buildTxDecodeCommand({ network: "testnet", rawTxHex: "0xabc" }).ok,
      false,
    );
    assert.equal(
      buildTxDecodeCommand({ network: "testnet", rawTxHex: "0xzzzz" }).ok,
      false,
    );
    assert.equal(
      buildTxDecodeCommand({ network: "testnet", rawTxHex: "0x" }).ok,
      false,
    );
  });
});

describe("CLI Cheat-Sheet — tx envelope", () => {
  it("builds tx envelope encode with kind, chain-id, optional 32-byte signing hash, and --json", () => {
    const signingHash = `0x${"ab".repeat(32)}`;
    const res = buildTxEnvelopeCommand({
      network: "testnet",
      mode: "encode",
      rawTxHex: EXAMPLE_RAW_TX_HEX,
      kind: "call",
      signingHash,
      json: true,
    });
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(
      res.command,
      `kovanica tx envelope encode ${EXAMPLE_RAW_TX_HEX} --chain-id 2 --kind call --signing-hash ${signingHash} --json`,
    );
  });

  it("rejects signing hash that is not 32 bytes", () => {
    const res = buildTxEnvelopeCommand({
      network: "testnet",
      mode: "encode",
      rawTxHex: EXAMPLE_RAW_TX_HEX,
      kind: "transfer",
      signingHash: "0x1234",
    });
    assert.equal(res.ok, false);
  });

  it("builds tx envelope decode for compact kvnc-tx:v1 and safely quotes raw JSON", () => {
    const compact = buildTxEnvelopeCommand({
      network: "devnet",
      mode: "decode",
      envelope: EXAMPLE_AIRGAP_ENVELOPE,
      json: false,
    });
    assert.equal(compact.ok, true);
    if (compact.ok) {
      assert.equal(
        compact.command,
        `kovanica tx envelope decode ${EXAMPLE_AIRGAP_ENVELOPE} --expected-chain-id 3`,
      );
    }

    const rawJson = buildTxEnvelopeCommand({
      network: "testnet",
      mode: "decode",
      envelope: '{"version":1,"chainId":2}',
      json: true,
    });
    assert.equal(rawJson.ok, true);
    if (rawJson.ok) {
      assert.equal(
        rawJson.command,
        "kovanica tx envelope decode '{\"version\":1,\"chainId\":2}' --expected-chain-id 2 --json",
      );
    }
  });

  it("rejects malformed or shell-injected envelopes", () => {
    assert.equal(
      buildTxEnvelopeCommand({
        network: "testnet",
        mode: "decode",
        envelope: "not-an-envelope",
      }).ok,
      false,
    );
    assert.equal(
      buildTxEnvelopeCommand({
        network: "testnet",
        mode: "decode",
        envelope: `${EXAMPLE_AIRGAP_ENVELOPE};echo pwned`,
      }).ok,
      false,
    );
  });
});

describe("CLI Cheat-Sheet — key inspect & dispatcher & shellQuote", () => {
  it("builds key inspect command via dispatcher", () => {
    const res = buildCliCommand({
      command: "key-inspect",
      keyfilePath: EXAMPLE_KEYFILE_PATH,
      json: true,
    });
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.chainId, null);
    assert.equal(res.command, "kovanica key inspect ./keystore.json --json");
  });

  it("rejects control chars in keyfile path", () => {
    const res = buildKeyInspectCommand({ keyfilePath: "./keystore.json\x00" });
    assert.equal(res.ok, false);
  });

  it("escapes single quotes in shellQuote", () => {
    assert.equal(shellQuote("plain-arg_1.2"), "plain-arg_1.2");
    assert.equal(shellQuote("dir with space"), "'dir with space'");
    assert.equal(shellQuote("a'b"), "'a'\\''b'");
  });
});
