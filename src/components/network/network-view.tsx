import { useEffect, useRef, useState } from "react";
import { SURFACE } from "@/lib/surfaces";
import { Activity, Globe, Server, Radio, RefreshCw, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, useApiSource, isPublic } from "@/lib/api/client";
import type { ApiBootstrap, ApiHead } from "@/lib/api/contract";
import { ATOM, NETWORK_LABEL, TOKEN } from "@/lib/api/contract";
import { shortId } from "@/lib/ledger/hash";
import { cn } from "@/lib/utils";
import { healthLabel, healthTone, errorStatusOf } from "@/lib/api/health";

type Snapshot = {
  head: ApiHead;
  bootstrap: ApiBootstrap;
  fetchedAt: number;
};

function fmtKvnc(atoms: number): string {
  return `${(atoms / ATOM).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${TOKEN}`;
}

/** Block/tip hashes are the only values the RPC can omit; render "n/a" for them. */
function na(value: string | null | undefined): string {
  return value ? value : "n/a";
}

export function NetworkView() {
  const source = useApiSource();
  const live = isPublic(source);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const genRef = useRef(0);
  const inFlightGenRef = useRef<number | null>(null);
  const currentSourceRef = useRef(source);
  currentSourceRef.current = source;

  async function load() {
    const reqSource = currentSourceRef.current;
    if (reqSource === "mainnet") return;
    const myGen = genRef.current;
    if (inFlightGenRef.current === myGen) return;
    inFlightGenRef.current = myGen;
    setBusy(true);
    setError(null);
    setErrorStatus(null);
    try {
      const [head, bootstrap] = await Promise.all([
        api<ApiHead>("/api/head"),
        api<ApiBootstrap>("/api/bootstrap"),
      ]);
      if (
        !head ||
        typeof head !== "object" ||
        typeof head.blocks !== "number" ||
        !bootstrap ||
        typeof bootstrap !== "object"
      ) {
        throw new Error("Malformed network status response");
      }
      if (myGen === genRef.current && reqSource === currentSourceRef.current) {
        setSnap({ head, bootstrap, fetchedAt: Date.now() });
      }
    } catch (e) {
      if (myGen === genRef.current && reqSource === currentSourceRef.current) {
        const msg = e instanceof Error ? e.message : "Failed to load network status";
        setError(msg);
        setErrorStatus(errorStatusOf(e));
      }
    } finally {
      if (inFlightGenRef.current === myGen) {
        inFlightGenRef.current = null;
      }
      if (myGen === genRef.current && reqSource === currentSourceRef.current) {
        setBusy(false);
      }
    }
  }

  useEffect(() => {
    genRef.current += 1;
    inFlightGenRef.current = null;
    setSnap(null);
    setError(null);
    setErrorStatus(null);
    setBusy(false);
    if (source === "mainnet") return;
    void load();
    const id = setInterval(() => void load(), 15_000);
    return () => {
      genRef.current += 1;
      inFlightGenRef.current = null;
      clearInterval(id);
    };
  }, [source]);

  if (source === "mainnet") {
    return <MainnetNetworkView />;
  }

  const b = snap?.bootstrap;
  const h = snap?.head;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 md:px-6 md:py-8">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] tracking-brand text-gold uppercase">Status</p>
          <h1 className="font-display text-3xl tracking-tight text-fg">Network</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Live view of {live ? NETWORK_LABEL : source} from the seed1 RPC. Auto-refreshes every 15s.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          disabled={busy}
          onClick={() => void load()}
          aria-label="Refresh"
        >
          <RefreshCw className={cn("size-4", busy && "animate-spin")} />
        </Button>
      </header>

      {error && (
        <div
          className={cn(
            "rounded-xl border px-4 py-3 text-sm",
            errorStatus === 503
              ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
              : "border-danger/40 bg-danger/5 text-danger",
          )}
        >
          {errorStatus === 503 ? `${healthLabel("stalled")} — ${error}` : error}
        </div>
      )}

      {!snap && !error && (
        <p className="text-center text-sm text-muted">Loading network status…</p>
      )}

      {snap && h && b && (
        <>
          {b.health && b.health.state !== "live" && (
            <div
              className={cn(
                "flex items-center gap-2 rounded-xl border px-4 py-3 text-sm",
                healthTone(b.health.state) === "warn"
                  ? "border-amber-500/40 bg-amber-500/5 text-amber-300"
                  : "border-danger/40 bg-danger/5 text-danger",
              )}
            >
              <AlertCircle className="size-4 shrink-0" />
              <span>{healthLabel(b.health.state)}</span>
            </div>
          )}

          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              icon={Activity}
              label="Committed height"
              value={h.blocks.toLocaleString()}
              sub={`tip ${h.tip ? shortId(h.tip) : "n/a"}`}
            />
            <StatCard
              icon={Globe}
              label="Network"
              value={NETWORK_LABEL}
              sub={`k = ${b.k} · min fee ${h.min_fee.toLocaleString()} atoms`}
            />
            <StatCard
              icon={Server}
              label="Peers"
              value={String(b.peers?.length ?? 0)}
              sub="reported by seed1"
            />
          </section>

          <section className="rounded-xl border border-border bg-surface p-4">
            <p className="text-[10px] tracking-wide text-subtle uppercase">Chain parameters</p>
            <dl className="mt-3 grid gap-3 sm:grid-cols-2">
              <Row label="Genesis" value={h.genesis ? shortId(h.genesis) : "n/a"} mono full={h.genesis ?? undefined} />
              <Row label="Tip" value={h.tip ? shortId(h.tip) : "n/a"} mono full={h.tip ?? undefined} />
              <Row label="Token" value={b.token ?? TOKEN} />
              <Row label="Subsidy" value={fmtKvnc(b.subsidy)} />
              <Row label="Founder amount" value={fmtKvnc(b.founder_amount)} />
              <Row label="Founder seed" value={String(b.founder_seed)} />
              <Row label="Atom" value={`1 ${TOKEN} = ${h.atom.toLocaleString()} atoms`} />
              <Row label="GHOSTDAG k" value={String(b.k)} />
              <Row
                label="Finality depth"
                value={b.finality_depth != null ? String(b.finality_depth) : "n/a — not reported by seed1"}
              />
            </dl>
            <p className="mt-3 text-[11px] leading-relaxed text-subtle">
              Genesis, tip and GHOSTDAG k are read from seed1 (k falls back to the spec value 5). Token, subsidy, founder amount/seed and atom are
              protocol spec constants, not values read from the node.
            </p>
          </section>

          <section className="rounded-xl border border-border bg-surface p-4">
            <div className="flex items-center gap-2">
              <Radio className="size-4 text-teal" />
              <p className="text-[10px] tracking-wide text-subtle uppercase">P2P</p>
            </div>
            <dl className="mt-3 grid gap-3 sm:grid-cols-2">
              <Row label="Listen" value={na(b.listen)} mono />
              <Row label="Bootstrap seeds" value="seed1.kovanica.online:8000" mono />
            </dl>
            <p className="mt-4 text-[10px] tracking-wide text-subtle uppercase">Connected peers</p>
            <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
              {(b.peers ?? []).length === 0 && (
                <li className="px-3 py-2 font-mono text-xs text-muted">n/a — seed1 reports no peers</li>
              )}
              {(b.peers ?? []).map((peer) => (
                <li key={peer} className="break-all px-3 py-2 font-mono text-xs text-fg">
                  {peer}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[11px] leading-relaxed text-subtle">
              Only the peers seed1 reports are shown. seed1 does not report other seed nodes or an
              observer, so none are rendered.
            </p>
          </section>

          {b.upstream && (
            <section className="rounded-xl border border-border bg-surface p-4">
              <p className="text-[10px] tracking-wide text-subtle uppercase">Upstream probe</p>
              {b.upstream.ok ? (
                <p className="mt-2 font-mono text-sm text-ok">
                  OK · tip {b.upstream.head.tip ? shortId(b.upstream.head.tip) : "n/a"} · {b.upstream.head.blocks} blocks
                </p>
              ) : (
                <p className="mt-2 text-sm text-muted">{b.upstream.error}</p>
              )}
            </section>
          )}

          <p className="text-center font-mono text-[11px] text-subtle">
            Last fetch {new Date(snap.fetchedAt).toLocaleTimeString()}
          </p>
        </>
      )}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  accent = "fg",
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  sub?: string;
  accent?: "fg" | "ok" | "muted";
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center gap-2 text-muted">
        <Icon className="size-3.5" />
        <p className="text-[10px] tracking-wide uppercase">{label}</p>
      </div>
      <p
        className={cn(
          "mt-2 font-display text-2xl tracking-tight",
          accent === "ok" && "text-ok",
          accent === "muted" && "text-muted",
          accent === "fg" && "text-fg",
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-1 truncate font-mono text-[11px] text-subtle">{sub}</p>}
    </div>
  );
}

function MainnetNetworkView() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 md:px-6 md:py-8">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] tracking-brand text-emerald-400 uppercase">Status</p>
          <h1 className="font-display text-3xl tracking-tight text-fg">Mainnet Pre-Launch</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            The production mainnet is scheduled for public launch on 1.1.2027 following the hybrid testnet and KovanicaHash audit.
          </p>
        </div>
      </header>

      <section className="rounded-xl border border-emerald-500/30 bg-surface p-6">
        <div className="flex items-center justify-between">
          <div>
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted">Environment</span>
            <h2 className="mt-1 font-display text-2xl text-fg">kovanica-mainnet</h2>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 font-mono text-xs text-emerald-400">
            <span className="size-1.5 rounded-full bg-emerald-400" />
            Launch: 1.1.2027
          </span>
        </div>

        <dl className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-lg bg-bg/50 p-3">
            <dt className="text-xs text-muted">Consensus</dt>
            <dd className="mt-1 font-mono text-sm text-fg">Hybrid PoW + GHOSTDAG (k=5)</dd>
          </div>
          <div className="rounded-lg bg-bg/50 p-3">
            <dt className="text-xs text-muted">Target Block Interval</dt>
            <dd className="mt-1 font-mono text-sm text-gold">4 s</dd>
          </div>
          <div className="rounded-lg bg-bg/50 p-3">
            <dt className="text-xs text-muted">Proof-of-Work</dt>
            <dd className="mt-1 font-mono text-sm text-fg">KovanicaHash (audit required)</dd>
          </div>
          <div className="rounded-lg bg-bg/50 p-3">
            <dt className="text-xs text-muted">Native Token</dt>
            <dd className="mt-1 font-mono text-sm text-fg">KVNC (9 decimals)</dd>
          </div>
          <div className="rounded-lg bg-bg/50 p-3">
            <dt className="text-xs text-muted">Public RPC Endpoint</dt>
            <dd className="mt-1 font-mono text-sm text-muted">Not open yet (opens at genesis)</dd>
          </div>
          <div className="rounded-lg bg-bg/50 p-3">
            <dt className="text-xs text-muted">Ledger Ordering</dt>
            <dd className="mt-1 font-mono text-sm text-fg">GHOSTDAG (k = 5)</dd>
          </div>
        </dl>

        <div className="mt-6 flex flex-wrap gap-3">
          <Button asChild variant="gold" className="h-10 px-5">
            <a href={`${SURFACE.testnet}/network`}>View Testnet Network</a>
          </Button>
          <Button asChild variant="outline" className="h-10 px-5">
            <a href={`${SURFACE.landing}/roadmap`}>Protocol Roadmap</a>
          </Button>
        </div>
      </section>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
  full,
}: {
  label: string;
  value: string;
  mono?: boolean;
  full?: string;
}) {
  return (
    <div>
      <dt className="text-[10px] tracking-wide text-subtle uppercase">{label}</dt>
      <dd
        className={cn("mt-0.5 break-all text-sm text-fg", mono && "font-mono text-xs")}
        title={full}
      >
        {value}
      </dd>
    </div>
  );
}
