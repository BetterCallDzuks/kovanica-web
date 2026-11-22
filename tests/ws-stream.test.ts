import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KovanicaWsStream,
  WS_CLOSED,
  WS_OPEN,
  deriveLiveTransport,
  nextWsReconnectDelayMs,
  resolveWsUrl,
  type WebSocketLike,
  type WsStreamEvent,
  type WsStreamStatus,
} from "../src/lib/api/ws-stream";
import { parseWsUrl } from "../src/lib/public-config";

class FakeWebSocket implements WebSocketLike {
  static instances: FakeWebSocket[] = [];
  readyState = 0; // CONNECTING
  readonly url: string;
  readonly sent: string[] = [];
  closeCalls: Array<{ code?: number; reason?: string }> = [];

  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason });
    this.readyState = WS_CLOSED;
  }

  simulateOpen(): void {
    this.readyState = WS_OPEN;
    this.onopen?.({});
  }

  simulateMessage(payload: unknown): void {
    const data = typeof payload === "string" ? payload : JSON.stringify(payload);
    this.onmessage?.({ data });
  }

  simulateError(): void {
    this.onerror?.({});
  }

  simulateClose(code = 1006, reason = "abnormal"): void {
    this.readyState = WS_CLOSED;
    this.onclose?.({ code, reason });
  }
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test("parseWsUrl validates ws:// and wss:// URLs and rejects invalid values", () => {
  assert.equal(parseWsUrl("wss://rpc-testnet.kovanica.online/ws"), "wss://rpc-testnet.kovanica.online/ws");
  assert.equal(parseWsUrl("  ws://127.0.0.1:8545/ws  "), "ws://127.0.0.1:8545/ws");
  assert.equal(parseWsUrl("https://rpc-testnet.kovanica.online/rpc"), null);
  assert.equal(parseWsUrl("http://127.0.0.1:8545"), null);
  assert.equal(parseWsUrl("not-a-url"), null);
  assert.equal(parseWsUrl(""), null);
  assert.equal(parseWsUrl(undefined), null);
});

test("resolveWsUrl returns null for local and mainnet sources and honors explicit URL for testnet", () => {
  assert.equal(resolveWsUrl("local", "ws://127.0.0.1:8545/ws"), null);
  assert.equal(resolveWsUrl("mainnet", "wss://rpc.kovanica.online/ws"), null);
  assert.equal(
    resolveWsUrl("testnet", "wss://rpc-testnet.kovanica.online/ws"),
    "wss://rpc-testnet.kovanica.online/ws",
  );
  assert.equal(resolveWsUrl("testnet", "invalid"), null);
});

test("nextWsReconnectDelayMs computes bounded exponential backoff", () => {
  assert.equal(nextWsReconnectDelayMs(0, 1000, 30000), 1000);
  assert.equal(nextWsReconnectDelayMs(1, 1000, 30000), 2000);
  assert.equal(nextWsReconnectDelayMs(2, 1000, 30000), 4000);
  assert.equal(nextWsReconnectDelayMs(3, 1000, 30000), 8000);
  assert.equal(nextWsReconnectDelayMs(4, 1000, 30000), 16000);
  assert.equal(nextWsReconnectDelayMs(5, 1000, 30000), 30000);
  assert.equal(nextWsReconnectDelayMs(10, 1000, 30000), 30000);
});

test("deriveLiveTransport maps pause flag and WS status to UI transport badges", () => {
  assert.equal(deriveLiveTransport(true, "connected"), "paused");
  assert.equal(deriveLiveTransport(true, "fallback"), "paused");
  assert.equal(deriveLiveTransport(false, "connected"), "ws");
  assert.equal(deriveLiveTransport(false, "connecting"), "reconnecting");
  assert.equal(deriveLiveTransport(false, "reconnecting"), "reconnecting");
  assert.equal(deriveLiveTransport(false, "fallback"), "polling");
  assert.equal(deriveLiveTransport(false, "idle"), "polling");
  assert.equal(deriveLiveTransport(false, "closed"), "polling");
});

test("KovanicaWsStream subscribes to newHeads & newCommittedLeader and dispatches push events", async () => {
  FakeWebSocket.instances = [];
  const statuses: WsStreamStatus[] = [];
  const events: WsStreamEvent[] = [];

  const stream = new KovanicaWsStream({
    url: "ws://127.0.0.1:8545/ws",
    WebSocketImpl: FakeWebSocket,
    onStatusChange: (s) => statuses.push(s),
    onEvent: (e) => events.push(e),
  });

  stream.start();
  assert.equal(FakeWebSocket.instances.length, 1);
  assert.deepEqual(statuses, ["connecting"]);

  const ws = FakeWebSocket.instances[0]!;
  ws.simulateOpen();
  await flushMicrotasks();

  // First subscribe request: newHeads
  assert.equal(ws.sent.length, 1);
  const req1 = JSON.parse(ws.sent[0]!);
  assert.equal(req1.jsonrpc, "2.0");
  assert.equal(req1.method, "kovanica_subscribe");
  assert.deepEqual(req1.params, ["newHeads"]);

  ws.simulateMessage({ jsonrpc: "2.0", id: req1.id, result: "sub-heads-1" });
  await flushMicrotasks();

  // Second subscribe request: newCommittedLeader
  assert.equal(ws.sent.length, 2);
  const req2 = JSON.parse(ws.sent[1]!);
  assert.equal(req2.method, "kovanica_subscribe");
  assert.deepEqual(req2.params, ["newCommittedLeader"]);

  ws.simulateMessage({ jsonrpc: "2.0", id: req2.id, result: "sub-leader-1" });
  await flushMicrotasks();

  assert.equal(stream.status, "connected");
  assert.deepEqual(statuses, ["connecting", "connected"]);
  assert.equal(stream.activeSubscriptions.length, 2);

  // Dispatch newHeads notification
  ws.simulateMessage({
    jsonrpc: "2.0",
    method: "kovanica_subscription",
    params: {
      subscription: "sub-heads-1",
      result: { hash: "0xabc123", round: 42 },
    },
  });

  // Dispatch newCommittedLeader notification
  ws.simulateMessage({
    jsonrpc: "2.0",
    method: "kovanica_subscription",
    params: {
      subscription: "sub-leader-1",
      result: {
        leader: { hash: "0xdef456", round: 43 },
        leaderRound: 43,
        leaderAuthor: 1,
        blocks: [{ hash: "0xdef456" }],
      },
    },
  });

  assert.equal(events.length, 2);
  assert.equal(events[0]!.kind, "newHead");
  if (events[0]!.kind === "newHead") {
    assert.equal(events[0]!.head.hash, "0xabc123");
  }
  assert.equal(events[1]!.kind, "committedLeader");
  if (events[1]!.kind === "committedLeader") {
    assert.equal(events[1]!.leader.leaderRound, 43);
  }

  // Clean unmount sends kovanica_unsubscribe for both active subscriptions
  stream.stop();
  const unsubMsgs = ws.sent.slice(2).map((raw) => JSON.parse(raw));
  assert.equal(unsubMsgs.length, 2);
  assert.equal(unsubMsgs[0].method, "kovanica_unsubscribe");
  assert.deepEqual(unsubMsgs[0].params, ["sub-heads-1"]);
  assert.equal(unsubMsgs[1].method, "kovanica_unsubscribe");
  assert.deepEqual(unsubMsgs[1].params, ["sub-leader-1"]);
  assert.equal(ws.closeCalls.length, 1);
  assert.equal(stream.status, "closed");
});

test("KovanicaWsStream reconnects with exponential backoff and re-subscribes after drop", async () => {
  FakeWebSocket.instances = [];
  const statuses: WsStreamStatus[] = [];

  const stream = new KovanicaWsStream({
    url: "ws://127.0.0.1:8545/ws",
    WebSocketImpl: FakeWebSocket,
    initialReconnectDelayMs: 15,
    maxReconnectDelayMs: 60,
    maxReconnectAttempts: 3,
    subscribeCommittedLeader: false,
    onStatusChange: (s) => statuses.push(s),
  });

  stream.start();
  const ws1 = FakeWebSocket.instances[0]!;
  ws1.simulateOpen();
  await flushMicrotasks();
  const req1 = JSON.parse(ws1.sent[0]!);
  ws1.simulateMessage({ jsonrpc: "2.0", id: req1.id, result: "sub-1" });
  await flushMicrotasks();
  assert.equal(stream.status, "connected");

  // Drop connection unexpectedly
  ws1.simulateClose(1006, "network drop");
  assert.equal(stream.status, "reconnecting");

  // Wait for reconnect timer (15ms)
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(FakeWebSocket.instances.length, 2);

  const ws2 = FakeWebSocket.instances[1]!;
  ws2.simulateOpen();
  await flushMicrotasks();
  const req2 = JSON.parse(ws2.sent[0]!);
  assert.equal(req2.method, "kovanica_subscribe");
  assert.deepEqual(req2.params, ["newHeads"]);

  ws2.simulateMessage({ jsonrpc: "2.0", id: req2.id, result: "sub-2" });
  await flushMicrotasks();
  assert.equal(stream.status, "connected");
  assert.deepEqual(statuses, ["connecting", "connected", "reconnecting", "connected"]);

  stream.stop();
});

test("KovanicaWsStream falls back to HTTP polling after maxReconnectAttempts failures", async () => {
  FakeWebSocket.instances = [];
  const statuses: WsStreamStatus[] = [];

  const stream = new KovanicaWsStream({
    url: "ws://127.0.0.1:8545/ws",
    WebSocketImpl: FakeWebSocket,
    initialReconnectDelayMs: 10,
    maxReconnectDelayMs: 20,
    maxReconnectAttempts: 2,
    onStatusChange: (s) => statuses.push(s),
  });

  stream.start();
  assert.equal(FakeWebSocket.instances.length, 1);

  // Attempt 0 fails -> schedules reconnect #1 (10ms)
  FakeWebSocket.instances[0]!.simulateError();
  FakeWebSocket.instances[0]!.simulateClose();
  assert.equal(stream.status, "reconnecting");

  await new Promise((r) => setTimeout(r, 25));
  assert.equal(FakeWebSocket.instances.length, 2);

  // Attempt 1 fails -> schedules reconnect #2 (20ms)
  FakeWebSocket.instances[1]!.simulateClose();
  assert.equal(stream.status, "reconnecting");

  await new Promise((r) => setTimeout(r, 35));
  assert.equal(FakeWebSocket.instances.length, 3);

  // Attempt 2 fails -> exceeds maxReconnectAttempts -> transitions to fallback
  FakeWebSocket.instances[2]!.simulateClose();
  assert.equal(stream.status, "fallback");
  assert.equal(deriveLiveTransport(false, stream.status), "polling");

  // Confirm no further reconnect sockets are spawned
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(FakeWebSocket.instances.length, 3);

  stream.stop();
});
