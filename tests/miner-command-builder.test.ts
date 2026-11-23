import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EXAMPLE_PRO21_PAYOUT_ADDRESS,
  MINER_CONSENSUS_SPECS,
  MINER_NETWORK_SPECS,
  buildKovanicaMinerCommand,
} from "../src/lib/explorer/miner-command";

test("frozen consensus and network constants remain intact", () => {
  assert.equal(MINER_NETWORK_SPECS.mainnet.chainId, 1);
  assert.equal(MINER_NETWORK_SPECS.mainnet.networkTag, "1-f35df34c92001436");
  assert.equal(MINER_NETWORK_SPECS.testnet.chainId, 2);
  assert.equal(MINER_NETWORK_SPECS.testnet.networkTag, "2-24cdb5fadd98b207");
  assert.equal(MINER_NETWORK_SPECS.devnet.chainId, 3);

  assert.equal(MINER_CONSENSUS_SPECS.powAlgorithm, "KovanicaHash");
  assert.equal(MINER_CONSENSUS_SPECS.ghostdagK, 5);
  assert.equal(MINER_CONSENSUS_SPECS.targetBlockTimeSec, 4);
  assert.equal(MINER_CONSENSUS_SPECS.initialRewardKvnc, 2.5);
  assert.equal(MINER_CONSENSUS_SPECS.blocksPerEra, 8_200_000);
  assert.equal(MINER_CONSENSUS_SPECS.eraDecayNumerator, 3);
  assert.equal(MINER_CONSENSUS_SPECS.eraDecayDenominator, 4);
});

test("buildKovanicaMinerCommand builds valid Stratum TLS command for testnet and mainnet", () => {
  const testnetRes = buildKovanicaMinerCommand({
    mode: "stratum",
    network: "testnet",
    endpoint: "stratum+tls://pool.kovanica.online:3333",
    payoutAddress: EXAMPLE_PRO21_PAYOUT_ADDRESS,
    workerName: "rig-01",
    threads: 8,
    tls: true,
    tlsServerName: "pool.kovanica.online",
    tlsCaCert: "/etc/kovanica/ca.pem",
  });

  assert.equal(testnetRes.ok, true);
  if (!testnetRes.ok) return;
  assert.equal(testnetRes.chainId, 2);
  assert.equal(testnetRes.networkTag, "2-24cdb5fadd98b207");
  assert.equal(
    testnetRes.command,
    `kovanica mine --chain-id 2 --stratum stratum+tls://pool.kovanica.online:3333 --tls --tls-server-name pool.kovanica.online --tls-ca-cert /etc/kovanica/ca.pem --address ${EXAMPLE_PRO21_PAYOUT_ADDRESS} --worker rig-01 --threads 8`,
  );

  const mainnetRes = buildKovanicaMinerCommand({
    mode: "stratum",
    network: "mainnet",
    endpoint: "pool.kovanica.online:3333",
    payoutAddress: EXAMPLE_PRO21_PAYOUT_ADDRESS,
    tls: true,
  });

  assert.equal(mainnetRes.ok, true);
  if (!mainnetRes.ok) return;
  assert.equal(mainnetRes.chainId, 1);
  assert.equal(mainnetRes.networkTag, "1-f35df34c92001436");
  assert.ok(mainnetRes.command.includes("--chain-id 1"));
  assert.ok(mainnetRes.command.includes("--stratum pool.kovanica.online:3333"));
  assert.ok(mainnetRes.command.includes("--tls"));
  assert.ok(!mainnetRes.command.includes("--rpc-url"));
});

test("buildKovanicaMinerCommand builds valid Solo RPC command", () => {
  const soloRes = buildKovanicaMinerCommand({
    mode: "solo",
    network: "testnet",
    endpoint: "http://127.0.0.1:8545",
    payoutAddress: EXAMPLE_PRO21_PAYOUT_ADDRESS,
    threads: 4,
  });

  assert.equal(soloRes.ok, true);
  if (!soloRes.ok) return;
  assert.equal(soloRes.chainId, 2);
  assert.equal(soloRes.networkTag, "2-24cdb5fadd98b207");
  assert.equal(
    soloRes.command,
    `kovanica mine --chain-id 2 --rpc-url http://127.0.0.1:8545 --address ${EXAMPLE_PRO21_PAYOUT_ADDRESS} --threads 4`,
  );
  assert.ok(!soloRes.command.includes("--stratum"));
  assert.ok(!soloRes.command.includes("--tls"));
});

test("buildKovanicaMinerCommand rejects shell-injection metacharacters across all fields", () => {
  const injectionPayloads = [
    "; rm -rf /",
    "$(whoami)",
    "`id`",
    "| cat /etc/passwd",
    "&& echo pwned",
    "foo\nbar",
    "foo'bar",
    'foo"bar',
  ];

  for (const payload of injectionPayloads) {
    const badEndpoint = buildKovanicaMinerCommand({
      mode: "stratum",
      network: "testnet",
      endpoint: `stratum+tls://pool.kovanica.online:3333${payload}`,
      payoutAddress: EXAMPLE_PRO21_PAYOUT_ADDRESS,
      tls: true,
    });
    assert.equal(badEndpoint.ok, false, `Endpoint must reject injection: ${payload}`);

    const badRpc = buildKovanicaMinerCommand({
      mode: "solo",
      network: "testnet",
      endpoint: `http://127.0.0.1:8545/${payload}`,
      payoutAddress: EXAMPLE_PRO21_PAYOUT_ADDRESS,
    });
    assert.equal(badRpc.ok, false, `RPC URL must reject injection: ${payload}`);

    const badAddress = buildKovanicaMinerCommand({
      mode: "solo",
      network: "testnet",
      endpoint: "http://127.0.0.1:8545",
      payoutAddress: `${EXAMPLE_PRO21_PAYOUT_ADDRESS}${payload}`,
    });
    assert.equal(badAddress.ok, false, `Payout address must reject injection: ${payload}`);

    const badWorker = buildKovanicaMinerCommand({
      mode: "stratum",
      network: "testnet",
      endpoint: "stratum+tls://pool.kovanica.online:3333",
      payoutAddress: EXAMPLE_PRO21_PAYOUT_ADDRESS,
      workerName: `rig1${payload}`,
      tls: true,
    });
    assert.equal(badWorker.ok, false, `Worker name must reject injection: ${payload}`);

    const badSni = buildKovanicaMinerCommand({
      mode: "stratum",
      network: "testnet",
      endpoint: "stratum+tls://pool.kovanica.online:3333",
      payoutAddress: EXAMPLE_PRO21_PAYOUT_ADDRESS,
      tls: true,
      tlsServerName: `pool.kovanica.online${payload}`,
    });
    assert.equal(badSni.ok, false, `TLS SNI must reject injection: ${payload}`);

    const badCa = buildKovanicaMinerCommand({
      mode: "stratum",
      network: "testnet",
      endpoint: "stratum+tls://pool.kovanica.online:3333",
      payoutAddress: EXAMPLE_PRO21_PAYOUT_ADDRESS,
      tls: true,
      tlsCaCert: `/etc/ca.pem${payload}`,
    });
    assert.equal(badCa.ok, false, `TLS CA cert must reject injection: ${payload}`);
  }
});

test("buildKovanicaMinerCommand validates PRO-21 addresses vs devnet legacy hex and TLS/thread invariants", () => {
  const legacyHex = "a".repeat(64);

  // Legacy hex rejected on mainnet & testnet
  const testnetHex = buildKovanicaMinerCommand({
    mode: "solo",
    network: "testnet",
    endpoint: "http://127.0.0.1:8545",
    payoutAddress: legacyHex,
  });
  assert.equal(testnetHex.ok, false);

  const mainnetHex = buildKovanicaMinerCommand({
    mode: "solo",
    network: "mainnet",
    endpoint: "http://127.0.0.1:8545",
    payoutAddress: legacyHex,
  });
  assert.equal(mainnetHex.ok, false);

  // Legacy hex accepted on devnet (Chain 3)
  const devnetHex = buildKovanicaMinerCommand({
    mode: "solo",
    network: "devnet",
    endpoint: "http://127.0.0.1:8545",
    payoutAddress: legacyHex,
  });
  assert.equal(devnetHex.ok, true);
  if (devnetHex.ok) {
    assert.equal(devnetHex.chainId, 3);
  }

  // Malformed addresses rejected
  const emptyAddr = buildKovanicaMinerCommand({
    mode: "solo",
    network: "testnet",
    endpoint: "http://127.0.0.1:8545",
    payoutAddress: "   ",
  });
  assert.equal(emptyAddr.ok, false);

  const shortAddr = buildKovanicaMinerCommand({
    mode: "solo",
    network: "testnet",
    endpoint: "http://127.0.0.1:8545",
    payoutAddress: "kvncshortdag",
  });
  assert.equal(shortAddr.ok, false);

  // Invalid thread counts rejected
  for (const badThreads of [0, -1, 1.5, Number.NaN, 512]) {
    const res = buildKovanicaMinerCommand({
      mode: "solo",
      network: "testnet",
      endpoint: "http://127.0.0.1:8545",
      payoutAddress: EXAMPLE_PRO21_PAYOUT_ADDRESS,
      threads: badThreads,
    });
    assert.equal(res.ok, false, `Threads=${String(badThreads)} must be rejected`);
  }

  // Conflicting TLS + stratum+tcp:// rejected
  const conflictingTls = buildKovanicaMinerCommand({
    mode: "stratum",
    network: "testnet",
    endpoint: "stratum+tcp://pool.kovanica.online:3333",
    payoutAddress: EXAMPLE_PRO21_PAYOUT_ADDRESS,
    tls: true,
  });
  assert.equal(conflictingTls.ok, false);

  // --tls-server-name without TLS rejected
  const sniWithoutTls = buildKovanicaMinerCommand({
    mode: "stratum",
    network: "testnet",
    endpoint: "stratum+tcp://pool.kovanica.online:3333",
    payoutAddress: EXAMPLE_PRO21_PAYOUT_ADDRESS,
    tls: false,
    tlsServerName: "pool.kovanica.online",
  });
  assert.equal(sniWithoutTls.ok, false);
});
