import { MAINNET_NETWORK_TAG, TESTNET_NETWORK_TAG } from "../networkConstants";

export type PoolStratumNetwork = "mainnet" | "testnet";

export const POOL_FROZEN_SPEC = {
  powAlgorithm: "KovanicaHash",
  ghostdag: "GHOSTDAG K=5",
  targetBlockTime: "4s",
  initialBlockReward: "2.5 KVNC",
  subsidyEraBlocks: 8_200_000,
  decayFactor: "3/4",
  feeSplit: "3/4 burn / 1/4 miner",
  tlsRequired: true,
  mainnetTag: MAINNET_NETWORK_TAG,
  testnetTag: TESTNET_NETWORK_TAG,
} as const;

export type PoolFrozenSpec = typeof POOL_FROZEN_SPEC;

export interface PoolStratumSummary {
  readonly network: PoolStratumNetwork;
  readonly label: string;
  readonly chainId: 1 | 2;
  readonly networkTag: string;
  readonly protocol: "Stratum v1";
  readonly tlsRequired: true;
  readonly varDiffMode: "adaptive";
  readonly gracefulDrainSupported: true;
  readonly gracefulDrainMethod: "client.reconnect";
  readonly frozenSpec: PoolFrozenSpec;
}

export function summarizePoolStratumConfig(network: PoolStratumNetwork): PoolStratumSummary {
  const isMainnet = network === "mainnet";
  return {
    network,
    label: isMainnet ? "Mainnet (Chain 1)" : "Testnet (Chain 2)",
    chainId: isMainnet ? 1 : 2,
    networkTag: isMainnet ? POOL_FROZEN_SPEC.mainnetTag : POOL_FROZEN_SPEC.testnetTag,
    protocol: "Stratum v1",
    tlsRequired: POOL_FROZEN_SPEC.tlsRequired,
    varDiffMode: "adaptive",
    gracefulDrainSupported: true,
    gracefulDrainMethod: "client.reconnect",
    frozenSpec: POOL_FROZEN_SPEC,
  };
}
