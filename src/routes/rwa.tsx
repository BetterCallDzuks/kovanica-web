import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  PauseCircle,
  Search,
  ShieldCheck,
  Users,
  Settings,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DEFAULT_RWA_REGISTRY,
  type RwaAssetClass,
  type RwaRegistryEntry,
  formatRwaSupply,
} from "@/lib/rwa/compliance";

export const Route = createFileRoute("/rwa")({
  component: RwaExplorerRegistryPage,
});

const ASSET_CLASS_FILTERS: Array<"ALL" | RwaAssetClass> = [
  "ALL",
  "BOND",
  "RE",
  "COMMODITY",
  "INVOICE",
  "FUND",
  "OTHER",
];

function RwaExplorerRegistryPage() {
  const [assets, setAssets] = useState<readonly RwaRegistryEntry[]>(DEFAULT_RWA_REGISTRY);
  const [source, setSource] = useState<string>("registry");
  const [query, setQuery] = useState("");
  const [assetClass, setAssetClass] = useState<"ALL" | RwaAssetClass>("ALL");

  useEffect(() => {
    let active = true;
    fetch("/api/rwa/registry")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { source?: string; assets?: RwaRegistryEntry[] } | null) => {
        if (!active || !data || !Array.isArray(data.assets) || data.assets.length === 0) return;
        setAssets(data.assets);
        if (data.source) setSource(data.source);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return assets.filter((a) => {
      if (assetClass !== "ALL" && a.assetClass !== assetClass) return false;
      if (!q) return true;
      return (
        a.name.toLowerCase().includes(q) ||
        a.symbol.toLowerCase().includes(q) ||
        a.issuerAddress.toLowerCase().includes(q) ||
        a.jurisdiction.toLowerCase().includes(q)
      );
    });
  }, [assets, assetClass, query]);

  const totalHolders = useMemo(
    () => assets.reduce((acc, a) => acc + a.holderCount, 0),
    [assets],
  );
  const activeCount = useMemo(() => assets.filter((a) => !a.paused).length, [assets]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-6 md:py-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link to="/explorer" className="text-muted hover:text-fg transition-colors">
            <ArrowLeft className="size-5" />
          </Link>
          <div>
            <p className="font-mono text-[10px] tracking-wide text-purple-400 uppercase">
              KVP-106 Institutional Registry · Source: {source}
            </p>
            <h1 className="font-display text-2xl tracking-tight text-fg">
              Real-World Assets (RWA) Explorer
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/wallet/rwa-manage">
            <Button variant="outline" size="sm" className="text-xs">
              <Settings className="size-3.5 mr-1.5" />
              Issuer Compliance Portal
            </Button>
          </Link>
          <Link to="/wallet/rwa-issue">
            <Button size="sm" className="text-xs">
              <Plus className="size-3.5 mr-1.5" />
              Issue RWA
            </Button>
          </Link>
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="flex items-center gap-2 text-xs text-muted">
            <Building2 className="size-3.5 text-purple-400" />
            <span>Registered KVP-106 Assets</span>
          </div>
          <p className="mt-1 font-mono text-2xl text-fg">{assets.length}</p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="flex items-center gap-2 text-xs text-muted">
            <ShieldCheck className="size-3.5 text-emerald-400" />
            <span>Active / Compliant</span>
          </div>
          <p className="mt-1 font-mono text-2xl text-emerald-400">
            {activeCount} / {assets.length}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="flex items-center gap-2 text-xs text-muted">
            <Users className="size-3.5 text-purple-400" />
            <span>Verified Holders</span>
          </div>
          <p className="mt-1 font-mono text-2xl text-fg">{totalHolders.toLocaleString("en-US")}</p>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="size-4 text-muted absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by symbol, name, jurisdiction, or issuer kvnc…dag"
            className="w-full h-10 rounded-md border border-border bg-surface pl-9 pr-3 text-xs text-fg"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {ASSET_CLASS_FILTERS.map((cls) => (
            <Button
              key={cls}
              size="sm"
              variant={assetClass === cls ? "default" : "outline"}
              onClick={() => setAssetClass(cls)}
              className="text-xs h-8"
            >
              {cls}
            </Button>
          ))}
        </div>
      </div>

      {/* Registry Directory Table */}
      <div className="rounded-xl border border-border bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-border bg-bg/60 text-muted font-mono uppercase text-[10px]">
              <tr>
                <th className="px-4 py-3">Asset</th>
                <th className="px-4 py-3">Class / Juris.</th>
                <th className="px-4 py-3 text-right">Total Supply / Cap</th>
                <th className="px-4 py-3 text-center">Compliance Status</th>
                <th className="px-4 py-3 text-right">Holders</th>
                <th className="px-4 py-3">Issuer (PRO-21)</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filtered.map((asset) => (
                <tr key={asset.assetId} className="hover:bg-bg/40 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-fg">{asset.symbol}</div>
                    <div className="text-[11px] text-muted">{asset.name}</div>
                  </td>
                  <td className="px-4 py-3 font-mono text-muted">
                    {asset.assetClass} · {asset.jurisdiction}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-fg">
                    <div>{formatRwaSupply(asset.totalSupply, asset.decimals)}</div>
                    <div className="text-[10px] text-muted">
                      Cap:{" "}
                      {asset.maxSupply === "0"
                        ? "Uncapped"
                        : formatRwaSupply(asset.maxSupply, asset.decimals)}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {asset.paused ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[10px] font-mono text-amber-400">
                        <PauseCircle className="size-3" />
                        PAUSED
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[10px] font-mono text-emerald-400">
                        <CheckCircle2 className="size-3" />
                        COMPLIANT
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-fg">
                    <div>{asset.holderCount}</div>
                    <div className="text-[10px] text-muted">{asset.frozenCount} frozen</div>
                  </td>
                  <td className="px-4 py-3 font-mono text-[11px] text-muted">
                    {asset.issuerAddress.slice(0, 12)}…{asset.issuerAddress.slice(-6)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link to="/wallet/rwa-manage">
                      <Button size="sm" variant="outline" className="text-xs h-7">
                        Manage
                      </Button>
                    </Link>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted">
                    No KVP-106 RWA tokens match your filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
