import { useCallback, useEffect, useRef, useState } from "react";
import { MIN_POLL_MS, useNode } from "./use-node";
import {
  KovanicaWsStream,
  deriveLiveTransport,
  resolveWsUrl,
  type LiveStreamTransport,
  type WsStreamEvent,
  type WsStreamStatus,
} from "./ws-stream";

export interface UseLiveStreamOptions {
  /** Fallback HTTP polling interval in ms (default 2000). */
  pollMs?: number;
  /** Optional explicit WebSocket URL override. */
  wsUrl?: string | null;
}

/**
 * Explorer live DAG & telemetry hook.
 *
 * Connects via JSON-RPC WebSocket (`kovanica_subscribe` for `newHeads` and
 * `newCommittedLeader`) when a WS endpoint is configured for a public testnet
 * source, handles exponential-backoff reconnect and clean unsubscribe on
 * unmount/pause, and seamlessly falls back to HTTP polling when WS is
 * unavailable or in `source=local` mode.
 */
export function useLiveStream(options: UseLiveStreamOptions = {}) {
  const pollMs = options.pollMs ?? MIN_POLL_MS;
  const [paused, setPaused] = useState(false);
  const [wsStatus, setWsStatus] = useState<WsStreamStatus>("idle");
  const [lastEvent, setLastEvent] = useState<WsStreamEvent | null>(null);
  const [eventCount, setEventCount] = useState(0);

  const node = useNode(pollMs, {
    paused,
    suspendPolling: wsStatus === "connected",
  });

  const refreshRef = useRef(node.refresh);
  refreshRef.current = node.refresh;

  const explicitWsUrl = options.wsUrl ?? null;

  useEffect(() => {
    if (paused) {
      setWsStatus("idle");
      return;
    }

    const wsUrl = resolveWsUrl(node.source, explicitWsUrl);
    if (!wsUrl) {
      setWsStatus("fallback");
      return;
    }

    const stream = new KovanicaWsStream({
      url: wsUrl,
      onStatusChange: (nextStatus) => {
        setWsStatus(nextStatus);
      },
      onEvent: (event) => {
        setLastEvent(event);
        setEventCount((c) => c + 1);
        void refreshRef.current();
      },
    });

    stream.start();

    return () => {
      stream.stop();
    };
  }, [node.source, paused, explicitWsUrl]);

  const togglePause = useCallback(() => {
    setPaused((prev) => !prev);
  }, []);

  const transport: LiveStreamTransport = deriveLiveTransport(paused, wsStatus);

  return {
    ...node,
    paused,
    setPaused,
    togglePause,
    wsStatus,
    transport,
    lastEvent,
    eventCount,
  };
}
