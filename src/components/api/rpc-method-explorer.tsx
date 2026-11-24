import { useMemo, useState } from "react";
import { Check, Code2, Copy, Search, Terminal } from "lucide-react";
import { DEFAULT_TESTNET_RPC_URL } from "@/lib/api/rpc-spec";
import {
  KOVANICA_SDK_VERSION,
  RPC_METHOD_CATALOG,
  RPC_METHOD_CATEGORIES,
  buildCurlSnippet,
  buildSdkSnippet,
  filterRpcMethods,
  type RpcMethodFilterCategory,
} from "@/lib/api/rpc-snippet-generator";
import { cn } from "@/lib/utils";

type SnippetTab = "curl" | "sdk";

const FILTER_CATEGORIES: readonly RpcMethodFilterCategory[] = ["All", ...RPC_METHOD_CATEGORIES];

/**
 * Interactive JSON-RPC 2.0 & HTTP method explorer with live search, category filters,
 * parameter summary, and tabbed shell-safe `curl` / `kovanica-sdk` snippet preview.
 */
export function RpcMethodExplorer() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<RpcMethodFilterCategory>("All");
  const [selectedId, setSelectedId] = useState<string>(RPC_METHOD_CATALOG[0].id);
  const [activeTab, setActiveTab] = useState<SnippetTab>("curl");
  const [rpcUrl, setRpcUrl] = useState<string>(DEFAULT_TESTNET_RPC_URL);
  const [copied, setCopied] = useState(false);

  const filteredMethods = useMemo(
    () => filterRpcMethods(query, category),
    [query, category],
  );

  const selectedMethod = useMemo(() => {
    return (
      filteredMethods.find((entry) => entry.id === selectedId) ??
      filteredMethods[0] ??
      null
    );
  }, [filteredMethods, selectedId]);

  const snippetResult = useMemo(() => {
    if (!selectedMethod) {
      return { ok: true as const, code: "" };
    }
    try {
      const code =
        activeTab === "curl"
          ? buildCurlSnippet(selectedMethod, rpcUrl)
          : buildSdkSnippet(selectedMethod, rpcUrl);
      return { ok: true as const, code };
    } catch (error) {
      return {
        ok: false as const,
        error: error instanceof Error ? error.message : "Invalid RPC URL.",
      };
    }
  }, [activeTab, rpcUrl, selectedMethod]);

  async function handleCopySnippet() {
    if (!snippetResult.ok || !snippetResult.code) return;
    try {
      await navigator.clipboard?.writeText(snippetResult.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div
      data-testid="rpc-method-explorer"
      className="rounded-xl border border-border bg-surface p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] tracking-brand text-gold uppercase">
            OpenAPI &amp; JSON-RPC 2.0 Explorer
          </p>
          <h2 className="mt-1 font-display text-lg tracking-tight text-fg">
            RPC Method Explorer &amp; Snippet Generator
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Filter Kovanica JSON-RPC 2.0 methods by category or keyword and copy shell-safe{" "}
            <code className="font-mono text-fg">curl</code> or{" "}
            <code className="font-mono text-fg">kovanica-sdk</code> (v{KOVANICA_SDK_VERSION})
            TypeScript snippets.
          </p>
        </div>

        <label className="flex w-full flex-col gap-1 sm:w-72">
          <span className="font-mono text-[10px] tracking-wide text-subtle uppercase">
            RPC Endpoint URL
          </span>
          <input
            type="url"
            value={rpcUrl}
            onChange={(event) => setRpcUrl(event.target.value)}
            placeholder={DEFAULT_TESTNET_RPC_URL}
            spellCheck={false}
            data-testid="rpc-explorer-url-input"
            className="h-8 rounded-md border border-border bg-bg px-2.5 font-mono text-xs text-fg outline-none transition-colors placeholder:text-subtle focus:border-blue"
          />
        </label>
      </div>

      {/* Search + category filter pills */}
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-subtle"
            aria-hidden="true"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search methods, params, or SDK helpers…"
            aria-label="Search RPC methods"
            data-testid="rpc-explorer-search-input"
            className="h-9 w-full rounded-md border border-border bg-bg pr-3 pl-8 font-mono text-xs text-fg outline-none transition-colors placeholder:text-subtle focus:border-blue"
          />
        </div>

        <div
          role="group"
          aria-label="Filter RPC methods by category"
          className="flex flex-wrap items-center gap-1.5"
        >
          {FILTER_CATEGORIES.map((item) => {
            const active = category === item;
            return (
              <button
                key={item}
                type="button"
                data-testid={`rpc-category-pill-${item.toLowerCase()}`}
                aria-pressed={active}
                onClick={() => setCategory(item)}
                className={cn(
                  "rounded-md border px-2.5 py-1 font-mono text-[11px] transition-colors",
                  active
                    ? "border-blue bg-surface-2 text-fg"
                    : "border-border bg-bg text-muted hover:bg-surface-2 hover:text-fg",
                )}
              >
                {item}
              </button>
            );
          })}
        </div>
      </div>

      {/* Method list + detail/snippet split */}
      <div className="mt-4 grid gap-4 lg:grid-cols-12">
        <div
          data-testid="rpc-method-list"
          className="flex flex-col gap-1.5 lg:col-span-5"
        >
          {filteredMethods.length === 0 ? (
            <div className="rounded-lg border border-border bg-bg p-4 text-center">
              <p className="font-mono text-xs text-muted">
                No RPC methods match your filter.
              </p>
            </div>
          ) : (
            filteredMethods.map((entry) => {
              const isSelected = selectedMethod?.id === entry.id;
              return (
                <button
                  key={entry.id}
                  type="button"
                  data-testid={`rpc-method-item-${entry.id}`}
                  onClick={() => {
                    setSelectedId(entry.id);
                    setCopied(false);
                  }}
                  className={cn(
                    "w-full rounded-lg border px-3 py-2.5 text-left transition-colors",
                    isSelected
                      ? "border-blue bg-surface-2"
                      : "border-border bg-bg hover:bg-surface-2/60",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <code className="truncate font-mono text-xs font-medium text-blue">
                      {entry.method}
                    </code>
                    <span className="shrink-0 rounded bg-surface px-1.5 py-0.5 font-mono text-[10px] text-teal">
                      {entry.category}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted">{entry.summary}</p>
                </button>
              );
            })
          )}
        </div>

        <div className="flex flex-col gap-3 rounded-lg border border-border bg-bg p-4 lg:col-span-7">
          {selectedMethod ? (
            <>
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-surface px-1.5 py-0.5 font-mono text-[10px] text-gold uppercase">
                      {selectedMethod.transport === "http-get" ? "HTTP GET" : "JSON-RPC 2.0"}
                    </span>
                    <code className="font-mono text-sm font-medium text-fg">
                      {selectedMethod.method}
                    </code>
                  </div>
                  <span className="font-mono text-[11px] text-subtle">
                    SDK: <code className="text-teal">{selectedMethod.sdkHelper}</code>
                  </span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-muted">
                  {selectedMethod.description}
                </p>
                <p className="mt-1.5 font-mono text-[11px] text-subtle">
                  Returns: <span className="text-fg">{selectedMethod.returns}</span>
                </p>
              </div>

              {/* Parameter summary */}
              <div className="rounded-md border border-border/80 bg-surface/60 p-3">
                <p className="font-mono text-[10px] tracking-wide text-subtle uppercase">
                  Parameters ({selectedMethod.params.length})
                </p>
                {selectedMethod.params.length === 0 ? (
                  <p className="mt-1 font-mono text-xs text-muted">
                    No parameters required.
                  </p>
                ) : (
                  <div className="mt-2 space-y-2">
                    {selectedMethod.params.map((param) => (
                      <div
                        key={param.name}
                        className="flex flex-col gap-0.5 border-t border-border/60 pt-2 first:border-t-0 first:pt-0"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            <code className="font-mono text-xs text-fg">{param.name}</code>
                            <span
                              className={cn(
                                "font-mono text-[10px]",
                                param.required ? "text-gold" : "text-subtle",
                              )}
                            >
                              {param.required ? "required" : "optional"}
                            </span>
                          </div>
                          <span className="font-mono text-[10px] text-teal">{param.type}</span>
                        </div>
                        <p className="text-[11px] text-muted">{param.description}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Tabbed curl / kovanica-sdk snippet preview */}
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div
                    role="tablist"
                    aria-label="Snippet format"
                    className="inline-flex rounded-md border border-border bg-surface p-0.5"
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={activeTab === "curl"}
                      data-testid="rpc-snippet-tab-curl"
                      onClick={() => {
                        setActiveTab("curl");
                        setCopied(false);
                      }}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded px-2.5 py-1 font-mono text-xs transition-colors",
                        activeTab === "curl"
                          ? "bg-surface-2 text-fg"
                          : "text-muted hover:text-fg",
                      )}
                    >
                      <Terminal className="size-3.5 text-blue" aria-hidden="true" />
                      <span>curl</span>
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={activeTab === "sdk"}
                      data-testid="rpc-snippet-tab-sdk"
                      onClick={() => {
                        setActiveTab("sdk");
                        setCopied(false);
                      }}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded px-2.5 py-1 font-mono text-xs transition-colors",
                        activeTab === "sdk"
                          ? "bg-surface-2 text-fg"
                          : "text-muted hover:text-fg",
                      )}
                    >
                      <Code2 className="size-3.5 text-teal" aria-hidden="true" />
                      <span>kovanica-sdk v{KOVANICA_SDK_VERSION}</span>
                    </button>
                  </div>

                  <button
                    type="button"
                    data-testid="rpc-snippet-copy-btn"
                    disabled={!snippetResult.ok}
                    onClick={() => void handleCopySnippet()}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 font-mono text-xs text-fg transition-colors hover:bg-surface-2 disabled:opacity-50"
                  >
                    {copied ? (
                      <>
                        <Check className="size-3.5 text-ok" aria-hidden="true" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="size-3.5 text-muted" aria-hidden="true" />
                        <span>Copy snippet</span>
                      </>
                    )}
                  </button>
                </div>

                {snippetResult.ok ? (
                  <pre
                    data-testid="rpc-snippet-code"
                    className="mt-2 overflow-x-auto rounded-lg border border-border bg-surface p-3 font-mono text-xs leading-relaxed text-fg"
                  >
                    <code>{snippetResult.code}</code>
                  </pre>
                ) : (
                  <div
                    role="alert"
                    data-testid="rpc-snippet-error"
                    className="mt-2 rounded-lg border border-danger/50 bg-surface p-3 font-mono text-xs text-danger"
                  >
                    {snippetResult.error}
                  </div>
                )}
              </div>
            </>
          ) : (
            <p className="font-mono text-xs text-subtle">
              Select an RPC method to inspect parameters and generate snippets.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
