import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Download,
  History,
  RefreshCw,
} from "lucide-react";
import { api } from "@/lib/api/client";
import type { ApiHistory, ApiSource } from "@/lib/api/contract";
import { ATOM, assetLabel } from "@/lib/networkConstants";
import { shortId } from "@/lib/ledger/hash";
import { cn } from "@/lib/utils";
import {
  buildAccountHistoryFilename,
  classifyTxDirection,
  countAccountHistoryDirections,
  filterAccountHistoryByDirection,
  serializeAccountHistoryCsv,
  serializeAccountHistoryJson,
  type AccountHistoryDirectionCounts,
  type AccountHistoryExportFormat,
  type AccountHistoryRecord,
  type TxDirectionFilter,
} from "@/lib/explorer/account-history-export";

export interface AccountHistoryToolbarProps {
  address: string;
  direction: TxDirectionFilter;
  onDirectionChange: (direction: TxDirectionFilter) => void;
  counts: AccountHistoryDirectionCounts;
  filteredTransactions: readonly AccountHistoryRecord[];
  onExport?: (
    format: AccountHistoryExportFormat,
    filename: string,
    content: string,
  ) => void;
  disabled?: boolean;
  className?: string;
}

const DIRECTION_OPTIONS: readonly { id: TxDirectionFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "sent", label: "Sent" },
  { id: "received", label: "Received" },
];

function triggerBrowserDownload(
  filename: string,
  content: string,
  mimeType: string,
) {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Compact toolbar for Explorer account transaction history:
 * client-side All / Sent / Received direction filter buttons (with counts)
 * and sanitized CSV / JSON export actions.
 */
export function AccountHistoryToolbar({
  address,
  direction,
  onDirectionChange,
  counts,
  filteredTransactions,
  onExport,
  disabled = false,
  className,
}: AccountHistoryToolbarProps) {
  function handleExport(format: AccountHistoryExportFormat) {
    const filename = buildAccountHistoryFilename(address, direction, format);
    const content =
      format === "csv"
        ? serializeAccountHistoryCsv(filteredTransactions, address)
        : serializeAccountHistoryJson(filteredTransactions, address, direction);
    const mimeType =
      format === "csv"
        ? "text/csv;charset=utf-8"
        : "application/json;charset=utf-8";

    if (onExport) {
      onExport(format, filename, content);
    } else {
      triggerBrowserDownload(filename, content, mimeType);
    }
  }

  return (
    <div
      data-testid="account-history-toolbar"
      className={cn(
        "flex flex-wrap items-center justify-between gap-2",
        className,
      )}
    >
      <div
        role="group"
        aria-label="Filter account transactions by direction"
        className="inline-flex items-center rounded-md border border-border bg-bg/70 p-0.5"
      >
        {DIRECTION_OPTIONS.map((option) => {
          const active = direction === option.id;
          const count = counts[option.id];
          return (
            <button
              key={option.id}
              type="button"
              disabled={disabled}
              aria-pressed={active}
              data-testid={`account-history-filter-${option.id}`}
              onClick={() => onDirectionChange(option.id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 disabled:opacity-50",
                active
                  ? "bg-gold/20 text-fg shadow-xs"
                  : "text-muted hover:text-fg",
              )}
            >
              <span>{option.label}</span>
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.2 font-mono text-[10px] tabular-nums",
                  active
                    ? "bg-gold/25 text-gold"
                    : "bg-border/70 text-subtle",
                )}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          disabled={disabled}
          data-testid="account-history-export-csv"
          onClick={() => handleExport("csv")}
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-bg/70 px-2.5 text-[11px] font-medium text-fg transition-colors hover:border-gold/40 hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 disabled:opacity-50"
        >
          <Download className="size-3 text-gold" aria-hidden="true" />
          <span>Export CSV</span>
        </button>

        <button
          type="button"
          disabled={disabled}
          data-testid="account-history-export-json"
          onClick={() => handleExport("json")}
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-bg/70 px-2.5 text-[11px] font-medium text-fg transition-colors hover:border-gold/40 hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 disabled:opacity-50"
        >
          <Download className="size-3 text-gold" aria-hidden="true" />
          <span>Export JSON</span>
        </button>
      </div>
    </div>
  );
}

function formatSignedKvnc(deltaAtoms: number): string {
  const abs = Math.abs(deltaAtoms) / ATOM;
  const formatted = abs.toFixed(6).replace(/\.?0+$/, "");
  return `${deltaAtoms >= 0 ? "+" : "-"}${formatted}`;
}

export interface AccountHistoryPanelProps {
  address: string;
  source: ApiSource;
  className?: string;
}

/**
 * Explorer Address View transaction history panel wired with direction filtering
 * and sanitized CSV/JSON export.
 */
export function AccountHistoryPanel({
  address,
  source,
  className,
}: AccountHistoryPanelProps) {
  const [history, setHistory] = useState<ApiHistory | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [direction, setDirection] = useState<TxDirectionFilter>("all");

  const loadHistory = useCallback(
    async (signal?: AbortSignal) => {
      if (!address || source === "mainnet") return;
      setLoading(true);
      setError(null);
      try {
        const res = await api<ApiHistory>(
          `/api/history?address=${encodeURIComponent(address)}`,
          "GET",
          signal,
        );
        if (!signal?.aborted) {
          setHistory(res);
        }
      } catch (err) {
        if (!signal?.aborted) {
          setError(
            err instanceof Error ? err.message : "Failed to load account history",
          );
        }
      } finally {
        if (!signal?.aborted) {
          setLoading(false);
        }
      }
    },
    [address, source],
  );

  useEffect(() => {
    setDirection("all");
    setHistory(null);
    const controller = new AbortController();
    void loadHistory(controller.signal);
    return () => controller.abort();
  }, [loadHistory]);

  const allTxs = useMemo(() => history?.txs ?? [], [history]);

  const counts = useMemo(
    () => countAccountHistoryDirections(allTxs, address),
    [allTxs, address],
  );

  const filteredTxs = useMemo(
    () => filterAccountHistoryByDirection(allTxs, address, direction),
    [allTxs, address, direction],
  );

  return (
    <section
      data-testid="account-history-panel"
      aria-label="Account Transaction History"
      className={cn(
        "border-b border-border bg-surface/50 px-4 py-3 text-xs md:px-6",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <History className="size-3.5 text-gold" aria-hidden="true" />
            <h2 className="font-semibold text-fg">Account Transaction History</h2>
            {history ? (
              <span className="rounded-full border border-border bg-bg/70 px-2 py-0.5 font-mono text-[10px] text-muted tabular-nums">
                Balance: {(history.balance / ATOM).toFixed(4)} KVNC
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 break-all font-mono text-[11px] text-muted">
            {address}
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadHistory()}
          disabled={loading}
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-bg/70 px-2.5 text-[11px] font-medium text-muted transition-colors hover:text-fg disabled:opacity-50"
        >
          <RefreshCw className={cn("size-3", loading && "animate-spin")} />
          <span>Refresh</span>
        </button>
      </div>

      <AccountHistoryToolbar
        address={address}
        direction={direction}
        onDirectionChange={setDirection}
        counts={counts}
        filteredTransactions={filteredTxs}
        disabled={loading}
        className="mt-3"
      />

      {error ? (
        <p className="mt-3 rounded border border-danger/30 bg-danger/10 px-3 py-2 text-[11px] text-danger">
          {error}
        </p>
      ) : loading && !history ? (
        <p className="mt-3 font-mono text-[11px] text-muted">
          Loading account history…
        </p>
      ) : filteredTxs.length === 0 ? (
        <p className="mt-3 rounded border border-border/60 bg-bg/40 px-3 py-2 text-[11px] text-muted">
          {allTxs.length === 0
            ? "No transactions recorded for this address."
            : `No ${direction} transactions match the current filter.`}
        </p>
      ) : (
        <ul className="mt-3 max-h-64 space-y-1.5 overflow-y-auto pr-1">
          {filteredTxs.map((tx, idx) => {
            const resolved = classifyTxDirection(tx, address);
            const isSent = resolved === "sent";
            return (
              <li
                key={`${tx.tx}-${tx.block}-${idx}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded border border-border/60 bg-bg/50 px-3 py-1.5 font-mono text-[11px]"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase",
                      isSent
                        ? "bg-rose-500/10 text-rose-400"
                        : "bg-emerald-500/10 text-emerald-400",
                    )}
                  >
                    {isSent ? (
                      <ArrowUpRight className="size-3" aria-hidden="true" />
                    ) : (
                      <ArrowDownLeft className="size-3" aria-hidden="true" />
                    )}
                    {tx.kind}
                  </span>
                  <span className="truncate text-fg" title={tx.tx}>
                    {shortId(tx.tx, 8)}
                  </span>
                  <span className="text-subtle" title={tx.block}>
                    blk {shortId(tx.block, 6)}
                  </span>
                </div>

                <span
                  className={cn(
                    "font-semibold tabular-nums",
                    tx.delta < 0 ? "text-rose-400" : "text-emerald-400",
                  )}
                >
                  {formatSignedKvnc(tx.delta)} {assetLabel(tx.asset_id)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
