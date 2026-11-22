/**
 * Live WebSocket JSON-RPC stream client for Kovanica Explorer.
 *
 * Implements the `kovanica_subscribe` / `kovanica_unsubscribe` and
 * `kovanica_subscription` push notification protocol matching
 * `KovanicaWsClient` in `kovanica-sdk` (`GET /ws`).
 *
 * Designed to be framework-agnostic so it can be unit-tested in Node with a
 * mock WebSocket implementation and consumed by `useLiveStream` in React.
 */

import { parseWsUrl, PUBLIC_WS_URL } from "../public-config";
import type { ApiSource } from "./contract";

export const WS_OPEN = 1;
export const WS_CLOSING = 2;
export const WS_CLOSED = 3;

export const DEFAULT_WS_INITIAL_RECONNECT_MS = 1_000;
export const DEFAULT_WS_MAX_RECONNECT_MS = 30_000;
export const DEFAULT_WS_MAX_RECONNECT_ATTEMPTS = 5;
export const DEFAULT_WS_REQUEST_TIMEOUT_MS = 8_000;

export const WS_URL_STORAGE_KEY = "kovanica.ws_url";

/** Transport mode surfaced to Explorer telemetry UI. */
export type LiveStreamTransport = "ws" | "polling" | "reconnecting" | "paused";

/** Lifecycle state of `KovanicaWsStream`. */
export type WsStreamStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "fallback"
  | "closed";

/** Raw block header payload delivered by `newHeads` subscriptions. */
export interface WsNewHeadEvent {
  hash: string;
  digest?: string;
  author?: number;
  number?: string | number;
  round?: string | number;
  parents?: string[];
  transactions?: unknown[];
  statements?: string;
  signature?: string;
  [key: string]: unknown;
}

/** Committed leader sub-DAG payload delivered by `newCommittedLeader` subscriptions. */
export interface WsCommittedLeaderEvent {
  leader: WsNewHeadEvent;
  leaderRound: number | string;
  leaderAuthor: number;
  blocks: WsNewHeadEvent[];
}

export type WsStreamEvent =
  | { kind: "newHead"; head: WsNewHeadEvent; receivedAt: number }
  | { kind: "committedLeader"; leader: WsCommittedLeaderEvent; receivedAt: number };

/** Minimal WebSocket shape compatible with browser `WebSocket` and unit test mocks. */
export interface WebSocketLike {
  readonly readyState: number;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type WebSocketCtor = new (url: string) => WebSocketLike;

export interface KovanicaWsStreamOptions {
  /** Full WebSocket URL (`ws://` or `wss://`). */
  url: string;
  /** Injectable WebSocket constructor (defaults to `globalThis.WebSocket`). */
  WebSocketImpl?: WebSocketCtor;
  /** Initial reconnect delay in milliseconds. Default: 1000. */
  initialReconnectDelayMs?: number;
  /** Maximum reconnect delay in milliseconds. Default: 30000. */
  maxReconnectDelayMs?: number;
  /** Maximum consecutive failed reconnect attempts before falling back to HTTP polling. Default: 5. */
  maxReconnectAttempts?: number;
  /** JSON-RPC request timeout in milliseconds. Default: 8000. */
  requestTimeoutMs?: number;
  /** Whether to also subscribe to `newCommittedLeader` in addition to `newHeads`. Default: true. */
  subscribeCommittedLeader?: boolean;
  /** Called when a `newHeads` or `newCommittedLeader` push arrives. */
  onEvent?: (event: WsStreamEvent) => void;
  /** Called whenever the stream transitions lifecycle status. */
  onStatusChange?: (status: WsStreamStatus) => void;
  /** Optional error callback for transport/protocol errors. */
  onError?: (error: Error) => void;
}

/** Bounded exponential reconnect backoff (e.g. 1s -> 2s -> 4s -> 8s -> 16s -> 30s). */
export function nextWsReconnectDelayMs(
  attempt: number,
  initialMs = DEFAULT_WS_INITIAL_RECONNECT_MS,
  maxMs = DEFAULT_WS_MAX_RECONNECT_MS,
): number {
  const safeAttempt = Math.max(0, Math.floor(attempt));
  return Math.min(initialMs * Math.pow(2, safeAttempt), maxMs);
}

/**
 * Resolve the effective WebSocket endpoint for the active API source.
 *
 * - Always returns `null` for `local` (in-memory mock node uses HTTP polling)
 *   and `mainnet` (prelaunch placeholder).
 * - For `testnet`, checks explicit override -> browser `localStorage` override
 *   (`kovanica.ws_url`) -> build-time `KOVANICA_PUBLIC_WS_URL`.
 */
export function resolveWsUrl(
  source: ApiSource,
  explicitUrl?: string | null,
): string | null {
  if (source === "local" || source === "mainnet") {
    return null;
  }

  const fromExplicit = parseWsUrl(explicitUrl);
  if (fromExplicit) return fromExplicit;

  if (typeof window !== "undefined") {
    try {
      const fromStorage = parseWsUrl(window.localStorage.getItem(WS_URL_STORAGE_KEY));
      if (fromStorage) return fromStorage;
    } catch {
      // Storage may be unavailable in restricted contexts.
    }
  }

  return PUBLIC_WS_URL;
}

/** Derive the UI transport badge from pause flag + WS lifecycle status. */
export function deriveLiveTransport(
  paused: boolean,
  wsStatus: WsStreamStatus,
): LiveStreamTransport {
  if (paused) return "paused";
  if (wsStatus === "connected") return "ws";
  if (wsStatus === "connecting" || wsStatus === "reconnecting") return "reconnecting";
  return "polling";
}

interface PendingRpc {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

type SubscriptionTopic = "newHeads" | "newCommittedLeader";

export class KovanicaWsStream {
  readonly url: string;
  private readonly webSocketImpl?: WebSocketCtor;
  private readonly initialReconnectDelayMs: number;
  private readonly maxReconnectDelayMs: number;
  private readonly maxReconnectAttempts: number;
  private readonly requestTimeoutMs: number;
  private readonly subscribeCommittedLeader: boolean;
  private readonly onEvent?: (event: WsStreamEvent) => void;
  private readonly onStatusChange?: (status: WsStreamStatus) => void;
  private readonly onError?: (error: Error) => void;

  private ws: WebSocketLike | null = null;
  private _status: WsStreamStatus = "idle";
  private stopped = false;
  private idCounter = 1;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly pendingRequests = new Map<number, PendingRpc>();
  private readonly subscriptionsByServerId = new Map<string, SubscriptionTopic>();

  constructor(options: KovanicaWsStreamOptions) {
    const validated = parseWsUrl(options.url);
    if (!validated) {
      throw new Error(`Invalid WebSocket URL: ${options.url}`);
    }
    this.url = validated;
    this.webSocketImpl = options.WebSocketImpl;
    this.initialReconnectDelayMs =
      options.initialReconnectDelayMs ?? DEFAULT_WS_INITIAL_RECONNECT_MS;
    this.maxReconnectDelayMs = options.maxReconnectDelayMs ?? DEFAULT_WS_MAX_RECONNECT_MS;
    this.maxReconnectAttempts =
      options.maxReconnectAttempts ?? DEFAULT_WS_MAX_RECONNECT_ATTEMPTS;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_WS_REQUEST_TIMEOUT_MS;
    this.subscribeCommittedLeader = options.subscribeCommittedLeader ?? true;
    this.onEvent = options.onEvent;
    this.onStatusChange = options.onStatusChange;
    this.onError = options.onError;
  }

  get status(): WsStreamStatus {
    return this._status;
  }

  get activeSubscriptions(): ReadonlyArray<{ id: string; topic: SubscriptionTopic }> {
    return Array.from(this.subscriptionsByServerId.entries()).map(([id, topic]) => ({
      id,
      topic,
    }));
  }

  /** Start streaming. Safe to call once; subsequent calls while active are no-ops. */
  start(): void {
    if (
      this._status === "connecting" ||
      this._status === "connected" ||
      this._status === "reconnecting"
    ) {
      return;
    }
    this.stopped = false;
    this.reconnectAttempt = 0;
    this.openSocket("connecting");
  }

  /**
   * Cleanly unsubscribe active subscriptions (best-effort if socket is open),
   * cancel any pending reconnect timer, and close the WebSocket.
   */
  stop(): void {
    this.stopped = true;
    this.clearReconnectTimer();

    const socket = this.ws;
    const activeIds = Array.from(this.subscriptionsByServerId.keys());
    this.subscriptionsByServerId.clear();
    this.rejectAllPending(new Error("WebSocket stream stopped"));

    if (socket) {
      if (socket.readyState === WS_OPEN) {
        for (const subId of activeIds) {
          try {
            const req = {
              jsonrpc: "2.0",
              method: "kovanica_unsubscribe",
              params: [subId],
              id: this.idCounter++,
            };
            socket.send(JSON.stringify(req));
          } catch {
            // Best-effort unsubscribe on teardown.
          }
        }
      }
      this.detachSocket(socket);
      this.ws = null;
      if (socket.readyState !== WS_CLOSING && socket.readyState !== WS_CLOSED) {
        try {
          socket.close(1000, "client unmount");
        } catch {
          // Ignore errors closing an already-closing socket.
        }
      }
    }

    this.setStatus("closed");
  }

  private openSocket(initialStatus: "connecting" | "reconnecting"): void {
    if (this.stopped) return;

    const WsCtor =
      this.webSocketImpl ??
      (typeof globalThis.WebSocket === "function"
        ? (globalThis.WebSocket as unknown as WebSocketCtor)
        : undefined);

    if (!WsCtor) {
      this.emitError(new Error("WebSocket implementation unavailable; falling back to polling"));
      this.setStatus("fallback");
      return;
    }

    this.setStatus(initialStatus);

    let socket: WebSocketLike;
    try {
      socket = new WsCtor(this.url);
    } catch (err) {
      this.emitError(err instanceof Error ? err : new Error(String(err)));
      this.handleDisconnect();
      return;
    }

    this.ws = socket;

    socket.onopen = () => {
      if (this.ws !== socket || this.stopped) return;
      void this.subscribeAll(socket);
    };

    socket.onmessage = (event) => {
      if (this.ws !== socket || this.stopped) return;
      this.handleMessage(event.data);
    };

    socket.onerror = () => {
      if (this.ws !== socket || this.stopped) return;
      this.emitError(new Error("WebSocket transport error"));
    };

    socket.onclose = () => {
      if (this.ws !== socket) return;
      this.detachSocket(socket);
      this.ws = null;
      this.subscriptionsByServerId.clear();
      this.rejectAllPending(new Error("WebSocket connection closed"));

      if (!this.stopped) {
        this.handleDisconnect();
      }
    };
  }

  private async subscribeAll(socket: WebSocketLike): Promise<void> {
    try {
      const headsSubId = await this.sendRpc<string>(socket, "kovanica_subscribe", ["newHeads"]);
      if (this.ws !== socket || this.stopped) return;
      if (typeof headsSubId !== "string" || headsSubId.length === 0) {
        throw new Error("Invalid newHeads subscription response");
      }
      this.subscriptionsByServerId.set(headsSubId, "newHeads");

      if (this.subscribeCommittedLeader) {
        try {
          const leaderSubId = await this.sendRpc<string>(socket, "kovanica_subscribe", [
            "newCommittedLeader",
          ]);
          if (
            this.ws === socket &&
            !this.stopped &&
            typeof leaderSubId === "string" &&
            leaderSubId.length > 0
          ) {
            this.subscriptionsByServerId.set(leaderSubId, "newCommittedLeader");
          }
        } catch {
          // Older nodes may only support `newHeads`; keep the stream connected.
        }
      }

      if (this.ws !== socket || this.stopped) return;
      this.reconnectAttempt = 0;
      this.setStatus("connected");
    } catch (err) {
      if (this.ws !== socket || this.stopped) return;
      this.emitError(err instanceof Error ? err : new Error(String(err)));
      this.detachSocket(socket);
      this.ws = null;
      try {
        socket.close();
      } catch {
        // Ignore close errors.
      }
      this.handleDisconnect();
    }
  }

  private sendRpc<TResult>(
    socket: WebSocketLike,
    method: string,
    params: unknown[],
  ): Promise<TResult> {
    if (socket.readyState !== WS_OPEN) {
      return Promise.reject(new Error("WebSocket is not open"));
    }

    const id = this.idCounter++;
    const payload = JSON.stringify({
      jsonrpc: "2.0",
      method,
      params,
      id,
    });

    return new Promise<TResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`WebSocket RPC timeout after ${this.requestTimeoutMs}ms`));
      }, this.requestTimeoutMs);

      this.pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });

      try {
        socket.send(payload);
      } catch (err) {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private handleMessage(rawData: unknown): void {
    let text: string;
    if (typeof rawData === "string") {
      text = rawData;
    } else if (rawData instanceof ArrayBuffer) {
      text = new TextDecoder().decode(rawData);
    } else if (ArrayBuffer.isView(rawData)) {
      text = new TextDecoder().decode(rawData);
    } else {
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      this.emitError(new Error("Malformed JSON frame from WebSocket server"));
      return;
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return;
    }

    const record = parsed as Record<string, unknown>;
    if (record.jsonrpc !== "2.0") return;

    // Subscription push notification
    if (
      (record.method === "kovanica_subscription" || record.method === "eth_subscription") &&
      record.params &&
      typeof record.params === "object" &&
      !Array.isArray(record.params)
    ) {
      const params = record.params as { subscription?: unknown; result?: unknown };
      if (typeof params.subscription !== "string") return;
      const topic = this.subscriptionsByServerId.get(params.subscription);
      if (!topic || !params.result || typeof params.result !== "object") return;

      const receivedAt = Date.now();
      if (topic === "newHeads") {
        this.emitEvent({
          kind: "newHead",
          head: params.result as WsNewHeadEvent,
          receivedAt,
        });
      } else if (topic === "newCommittedLeader") {
        this.emitEvent({
          kind: "committedLeader",
          leader: params.result as WsCommittedLeaderEvent,
          receivedAt,
        });
      }
      return;
    }

    // Correlated JSON-RPC response
    if (typeof record.id !== "number") return;
    const pending = this.pendingRequests.get(record.id);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pendingRequests.delete(record.id);

    if (record.error && typeof record.error === "object") {
      const errObj = record.error as { code?: unknown; message?: unknown };
      const msg =
        typeof errObj.message === "string" ? errObj.message : "JSON-RPC subscription error";
      pending.reject(new Error(msg));
      return;
    }

    pending.resolve(record.result);
  }

  private handleDisconnect(): void {
    if (this.stopped) return;
    this.clearReconnectTimer();

    if (this.reconnectAttempt >= this.maxReconnectAttempts) {
      this.setStatus("fallback");
      return;
    }

    const delayMs = nextWsReconnectDelayMs(
      this.reconnectAttempt,
      this.initialReconnectDelayMs,
      this.maxReconnectDelayMs,
    );
    this.reconnectAttempt += 1;
    this.setStatus("reconnecting");

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.stopped) return;
      this.openSocket("reconnecting");
    }, delayMs);
  }

  private setStatus(next: WsStreamStatus): void {
    if (this._status === next) return;
    this._status = next;
    try {
      this.onStatusChange?.(next);
    } catch {
      // Never let listener errors crash the stream state machine.
    }
  }

  private emitEvent(event: WsStreamEvent): void {
    try {
      this.onEvent?.(event);
    } catch (err) {
      this.emitError(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private emitError(error: Error): void {
    try {
      this.onError?.(error);
    } catch {
      // Suppress secondary callback failures.
    }
  }

  private rejectAllPending(error: Error): void {
    for (const [id, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timer);
      this.pendingRequests.delete(id);
      pending.reject(error);
    }
  }

  private detachSocket(socket: WebSocketLike): void {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
