import { MAINNET_NETWORK_TAG, TESTNET_NETWORK_TAG } from "../networkConstants";

export interface CanonicalNetworkIdentity {
  readonly chainId: 1 | 2;
  readonly networkTag: string;
  readonly label: string;
}

export const CANONICAL_NETWORK_IDENTITIES = {
  mainnet: {
    chainId: 1,
    networkTag: MAINNET_NETWORK_TAG,
    label: "Mainnet (Chain 1)",
  },
  testnet: {
    chainId: 2,
    networkTag: TESTNET_NETWORK_TAG,
    label: "Testnet (Chain 2)",
  },
} as const satisfies Record<"mainnet" | "testnet", CanonicalNetworkIdentity>;

export const FROZEN_CONSENSUS_CONSTANTS = {
  powAlgorithm: "KovanicaHash",
  ghostdag: "GHOSTDAG K=5",
  targetBlockTime: "4s",
} as const;

export type ServiceReadinessStatus = "operational" | "degraded" | "offline";

export interface ServiceReadinessInput {
  readonly name: string;
  readonly status: ServiceReadinessStatus;
  readonly detail?: string;
}

export interface ServiceReadinessReport {
  readonly overall: ServiceReadinessStatus;
  readonly healthyCount: number;
  readonly totalCount: number;
  readonly alerts: string[];
}

export function evaluateServiceReadiness(
  services: readonly ServiceReadinessInput[],
): ServiceReadinessReport {
  const totalCount = services.length;
  if (totalCount === 0) {
    return {
      overall: "offline",
      healthyCount: 0,
      totalCount: 0,
      alerts: ["No ecosystem services reported"],
    };
  }

  let healthyCount = 0;
  let hasDegraded = false;
  let hasOffline = false;
  const alerts: string[] = [];

  for (const service of services) {
    if (service.status === "operational") {
      healthyCount += 1;
      continue;
    }

    if (service.status === "offline") {
      hasOffline = true;
    } else if (service.status === "degraded") {
      hasDegraded = true;
    }

    const detail = service.detail?.trim();
    alerts.push(
      detail ? `${service.name}: ${service.status} (${detail})` : `${service.name}: ${service.status}`,
    );
  }

  const overall: ServiceReadinessStatus = hasOffline
    ? "offline"
    : hasDegraded
      ? "degraded"
      : "operational";

  return {
    overall,
    healthyCount,
    totalCount,
    alerts,
  };
}
