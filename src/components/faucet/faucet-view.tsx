import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NetworkBadge } from "@/components/layout/network-badge";
import { MinimalHeader } from "@/components/layout/minimal-header";
import { SURFACE } from "@/lib/surfaces";
import { isAddr, hexToKvnc } from "@/lib/wallet/address";
import { cn } from "@/lib/utils";
import { NETWORK_ID } from "@/lib/api/contract";
import type { ApiState } from "@/lib/api/contract";
import { classifyFaucetError, faucetErrorFromBody, type FaucetErrorKind } from "@/lib/api/health";

/** The faucet dispenses a fixed amount; the server reports what it actually sent. */
const FIXED_KVNC = 10;
/** Addresses cool down for 24 h after one dispense. */
const COOLDOWN_S = 60;

type Phase = "idle" | "submitting" | "success";
type ErrorKind = "invalid-address" | FaucetErrorKind | null;

const ERROR_COPY: Record<Exclude<ErrorKind, null>, string> = {
  "invalid-address":
    "That doesn't look like a Kovanica address. Paste a canonical kvnc…dag address (PRO-21, 64 chars).",
  cap: "The faucet's request budget is used up right now. Try again in an hour.",
  dry: "The faucet is dry right now — the node has no funds to give. Try again in a bit.",
  stalled:
    "The testnet is stalled — the chain is not advancing right now. Your address is still valid; try again when blocks resume.",
  unavailable: "The faucet is not available on this deployment.",
  offline: "The testnet node is unreachable. Check back in a moment.",
  cooldown:
    "The faucet is cooling down: one dispense per address per 24 hours, five per hour per network address.",
  other: "",
};

/** Single-task testnet faucet — one card, one job. Wire to POST /api/faucet. */
export function FaucetView() {
  const [address, setAddress] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorKind, setErrorKind] = useState<ErrorKind>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [txId, setTxId] = useState("");
  const [grantedAtoms, setGrantedAtoms] = useState(0);
  const [copied, setCopied] = useState(false);
  const [cooldownLeft, setCooldownLeft] = useState(0);
  const [head, setHead] = useState<{ blocks: number; faucet: boolean } | null>(null);
  const [headError, setHeadError] = useState<FaucetErrorKind | null>(null);
  const [headLoading, setHeadLoading] = useState(true);

  /** 503 is a stalled chain, never "offline": keep the two states distinct. */
  async function fetchHead(): Promise<{
    head: { blocks: number; faucet: boolean } | null;
    error: FaucetErrorKind | null;
  }> {
    try {
      const r = await fetch("/api/state?source=testnet");
      if (!r.ok) {
        const body = await r.text().catch(() => "");
        return { head: null, error: classifyFaucetError(body, r.status) };
      }
      const d = (await r.json()) as ApiState;
      return { head: { blocks: d.node.blocks, faucet: d.faucet }, error: null };
    } catch {
      return { head: null, error: "offline" };
    }
  }

  useEffect(() => {
    let mounted = true;
    void fetchHead().then((res) => {
      if (!mounted) return;
      setHead(res.head);
      setHeadError(res.error);
      setHeadLoading(false);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const isCoolingDown = cooldownLeft > 0;

  useEffect(() => {
    if (!isCoolingDown) return;
    const id = window.setInterval(() => {
      setCooldownLeft((v) => {
        if (v <= 1) {
          window.clearInterval(id);
          return 0;
        }
        return v - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [isCoolingDown]);

  const raw = address.trim();
  const addrState = raw === "" ? "empty" : isAddr(raw) ? "valid" : "invalid";
  const normalized =
    addrState === "valid" && /^[0-9a-f]{64}$/i.test(raw) ? hexToKvnc(raw) : null;

  const faucetClosed = head !== null && !head.faucet;
  const disabledReason =
    phase === "submitting"
      ? null
      : cooldownLeft > 0
        ? `Faucet cooling down — ${cooldownLeft}s`
        : faucetClosed
          ? "The faucet is currently closed."
          : addrState === "invalid"
            ? "Enter a valid Kovanica address."
            : addrState === "empty"
              ? "Enter a Kovanica address first."
              : null;
  const canSubmit = phase !== "submitting" && !disabledReason;

  function classifyError(msg: string, status?: number | null) {
    const { kind, message } = faucetErrorFromBody(msg, status);
    setErrorKind(kind);
    if (kind === "cooldown") setCooldownLeft(COOLDOWN_S);
    setErrorMessage(message || msg);
  }

  async function submit() {
    if (!isAddr(raw)) {
      setErrorKind("invalid-address");
      return;
    }
    setErrorKind(null);
    setErrorMessage("");
    setPhase("submitting");
    try {
      // No `amount`: the faucet dispenses a fixed amount and reports what it sent.
      const r = await fetch(`/api/faucet?to=${encodeURIComponent(raw)}&source=testnet`, {
        method: "POST",
      });
      const text = await r.text();
      if (r.ok) {
        let tx = text.trim();
        let granted = FIXED_KVNC * 1_000_000_000;
        try {
          const j = JSON.parse(text) as {
            tx?: unknown;
            tx_hash?: unknown;
            amount?: unknown;
          };
          if (typeof j?.tx_hash === "string") tx = j.tx_hash;
          else if (typeof j?.tx === "string") tx = j.tx;
          if (typeof j?.amount === "number" && j.amount > 0) granted = j.amount;
        } catch {
          /* plain-text tx hash */
        }
        setTxId(tx);
        setGrantedAtoms(granted);
        setPhase("success");
        setCooldownLeft(COOLDOWN_S);
      } else {
        classifyError(text, r.status);
        setPhase("idle");
      }
    } catch {
      setErrorKind("offline");
      setPhase("idle");
    }
  }

  async function copyTx() {
    if (!txId) return;
    try {
      await navigator.clipboard.writeText(txId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — ignore */
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg">
      <MinimalHeader backTo={`${SURFACE.testnet}/explorer`} backLabel="Back to explorer" />
      <main className="flex flex-1 justify-center px-4 py-10 md:py-16">
        <div className="w-full max-w-md">
          <div className="flex items-center justify-between gap-2">
            <p className="eyebrow">{NETWORK_ID} · KVNC</p>
            <NetworkBadge />
          </div>
          <h1 className="mt-1 font-display text-3xl tracking-tight text-fg italic">
            Testnet faucet
          </h1>
          <p className="mt-1 text-sm text-muted">
            Fixed <strong className="text-fg">{FIXED_KVNC} KVNC</strong> per request, once per address
            every 24 h
            {" · "}Chain head{" "}
            {headLoading ? (
              <span className="font-mono text-muted">Loading…</span>
            ) : head ? (
              <span className="font-mono text-fg">#{head.blocks.toLocaleString()}</span>
            ) : (
              <span className="inline-flex items-center gap-1 font-mono text-muted">
                {headError === "stalled" ? "Stalled — chain not advancing" : "Unavailable"}
                <button
                  type="button"
                  onClick={() => {
                    setHeadLoading(true);
                    void fetchHead()
                      .then((res) => {
                        setHead(res.head);
                        setHeadError(res.error);
                      })
                      .finally(() => setHeadLoading(false));
                  }}
                  className="text-xs text-gold underline underline-offset-2 hover:text-gold/80"
                >
                  Retry
                </button>
              </span>
            )}
          </p>

          <div className="mt-6 rounded-xl border border-border bg-surface p-5">
            {/* Address */}
            <label htmlFor="faucet-address" className="eyebrow">
              Address
            </label>
            <input
              id="faucet-address"
              value={address}
              onChange={(e) => {
                setAddress(e.target.value);
                if (errorKind === "invalid-address") setErrorKind(null);
              }}
              placeholder="kvnc…dag (canonical PRO-21)"
              spellCheck={false}
              autoComplete="off"
              className={cn(
                "mt-2 h-11 w-full rounded-md border bg-bg px-3 font-mono text-sm text-fg outline-none transition-colors placeholder:text-subtle",
                addrState === "invalid"
                  ? "border-danger/70 focus:border-danger"
                  : "border-border focus:border-blue",
              )}
            />
            {addrState === "invalid" && (
              <p className="mt-1.5 text-xs text-danger">{ERROR_COPY["invalid-address"]}</p>
            )}
            {normalized && (
              <p className="mt-1.5 truncate font-mono text-[11px] text-subtle">
                → {normalized}
              </p>
            )}

            {/* Amount is fixed server-side; the browser never chooses it. */}
            <div className="mt-5 rounded-md border border-border bg-bg px-3 py-2">
              <span className="eyebrow">Amount</span>
              <p className="mt-1 font-mono text-sm text-fg">
                {FIXED_KVNC} KVNC <span className="text-subtle">· fixed by the faucet</span>
              </p>
            </div>

            {/* Submit */}
            <Button
              type="button"
              className="mt-5 h-12 w-full"
              disabled={!canSubmit}
              onClick={() => void submit()}
            >
              {phase === "submitting" ? "Sending…" : `Request ${FIXED_KVNC} KVNC`}
            </Button>
            {disabledReason && (
              <p className="mt-2 text-center text-xs text-subtle">{disabledReason}</p>
            )}
          </div>

          {/* Error faces */}
          {errorKind && (
            <div
              className={cn(
                "mt-4 rounded-xl border p-4 text-sm",
                errorKind === "offline" || errorKind === "other"
                  ? "border-danger/40 bg-danger/10 text-danger"
                  : errorKind === "stalled"
                    ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                    : "border-border bg-surface text-muted",
              )}
            >
              <p className="font-mono text-[10px] tracking-wide uppercase">
                {errorKind === "cap"
                  ? "Cap reached"
                  : errorKind === "dry"
                    ? "Faucet dry"
                    : errorKind === "stalled"
                      ? "Chain stalled"
                      : errorKind === "unavailable"
                        ? "Faucet unavailable"
                        : errorKind === "offline"
                          ? "Network offline"
                          : errorKind === "cooldown"
                            ? "Cooling down"
                            : errorKind === "invalid-address"
                              ? "Invalid address"
                              : "Request failed"}
              </p>
              <p className="mt-1">
                {errorKind === "other" && errorMessage
                  ? errorMessage
                  : ERROR_COPY[errorKind]}
              </p>
            </div>
          )}

          {/* Success panel */}
          {phase === "success" && txId && (
            <div className="mt-4 rounded-xl border border-ok/40 bg-ok/10 p-5">
              <p className="font-mono text-[10px] tracking-wide text-ok uppercase">Granted</p>
              <p className="mt-1 font-display text-2xl tracking-tight text-fg">
                {(grantedAtoms / 1_000_000_000).toLocaleString(undefined, {
                  maximumFractionDigits: 9,
                })}{" "}
                KVNC
              </p>
              <div className="mt-3 flex items-center justify-between gap-2 rounded-md bg-surface-2 px-3 py-2">
                <code className="min-w-0 truncate font-mono text-xs text-muted">{txId}</code>
                <button
                  type="button"
                  onClick={() => void copyTx()}
                  className="inline-flex shrink-0 items-center gap-1 font-mono text-[10px] tracking-wide text-blue uppercase transition-colors hover:text-fg"
                >
                  {copied ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <p className="mt-2 text-xs text-subtle">
                The faucet cools down for this address for 24 hours before the next dispense.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button asChild size="sm">
                  <a href={`${SURFACE.testnet}/explorer`}>View in explorer</a>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <a href={`${SURFACE.testnet}/wallet`}>Open wallet</a>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setPhase("idle");
                    setTxId("");
                    setAddress("");
                  }}
                >
                  Send another
                </Button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
