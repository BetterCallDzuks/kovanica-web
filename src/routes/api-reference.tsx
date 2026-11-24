import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Check, Copy, Terminal } from "lucide-react";
import { ApiReferenceView } from "@/components/api/api-reference-view";
import { RpcMethodExplorer } from "@/components/api/rpc-method-explorer";
import {
  DEFAULT_TESTNET_RPC_URL,
  RPC_IDENTITY_HEADERS,
  RPC_MEMPOOL_STATS_METHOD,
  buildRpcBatchCurlExample,
} from "@/lib/api/rpc-spec";

export const Route = createFileRoute("/api-reference")({ component: ApiReferencePage });

const BATCH_CURL_EXAMPLE = buildRpcBatchCurlExample(DEFAULT_TESTNET_RPC_URL);

function ApiReferencePage() {
  const [copied, setCopied] = useState(false);

  async function handleCopyCurl() {
    try {
      await navigator.clipboard?.writeText(BATCH_CURL_EXAMPLE);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="bg-bg text-fg">
      <ApiReferenceView />

      <section className="mx-auto w-full max-w-4xl px-4 pb-8 md:px-6">
        <RpcMethodExplorer />
      </section>

      <section className="mx-auto w-full max-w-4xl px-4 pb-10 md:px-6">
        <div
          data-testid="api-ref-identity-headers-card"
          className="rounded-xl border border-border bg-surface p-5"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] tracking-brand text-gold uppercase">
                JSON-RPC 2.0 Quick Reference
              </p>
              <h2 className="mt-1 font-display text-lg tracking-tight text-fg">
                RPC Identity Headers &amp;{" "}
                <code className="font-mono text-base text-blue">
                  {RPC_MEMPOOL_STATS_METHOD.method}
                </code>
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                Every <code className="font-mono text-fg">/rpc</code> and{" "}
                <code className="font-mono text-fg">/health</code> response attaches canonical chain
                identity headers exposed via{" "}
                <code className="font-mono text-fg">Access-Control-Expose-Headers</code>.
              </p>
            </div>
          </div>

          {/* Identity headers */}
          <div className="mt-4 grid gap-2.5 sm:grid-cols-3">
            {RPC_IDENTITY_HEADERS.map((header) => (
              <div
                key={header.name}
                className="rounded-lg border border-border bg-bg px-3 py-2.5"
              >
                <code className="block truncate font-mono text-xs font-medium text-blue">
                  {header.name}
                </code>
                <p className="mt-1 font-mono text-[11px] text-gold">Example: {header.example}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted">{header.description}</p>
              </div>
            ))}
          </div>

          {/* kovanica_mempoolStats fields */}
          <div className="mt-5 rounded-lg border border-border bg-bg p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Terminal className="size-3.5 text-blue" aria-hidden="true" />
                <code className="font-mono text-xs font-medium text-fg">
                  {RPC_MEMPOOL_STATS_METHOD.method}
                </code>
              </div>
              <span className="font-mono text-[11px] text-subtle">
                params: {RPC_MEMPOOL_STATS_METHOD.params}
              </span>
            </div>
            <p className="mt-1.5 text-xs text-muted">{RPC_MEMPOOL_STATS_METHOD.description}</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {RPC_MEMPOOL_STATS_METHOD.fields.map((field) => (
                <div
                  key={field.name}
                  className="flex flex-col gap-0.5 rounded-md border border-border/70 bg-surface/60 px-2.5 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <code className="font-mono text-xs text-fg">{field.name}</code>
                    <span className="font-mono text-[10px] text-teal">{field.type}</span>
                  </div>
                  <p className="text-[11px] text-muted">{field.description}</p>
                </div>
              ))}
            </div>
            <p className="mt-2.5 text-[11px] text-subtle">
              {RPC_MEMPOOL_STATS_METHOD.emptyBehavior}
            </p>
          </div>

          {/* Copyable JSON-RPC 2.0 batch curl example */}
          <div className="mt-4">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[11px] text-muted">
                Single-POST JSON-RPC 2.0 batch probe (with response headers)
              </span>
              <button
                type="button"
                data-testid="api-ref-copy-curl-btn"
                onClick={() => void handleCopyCurl()}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg px-2.5 py-1 font-mono text-xs text-fg transition-colors hover:bg-surface-2"
              >
                {copied ? (
                  <>
                    <Check className="size-3.5 text-ok" aria-hidden="true" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="size-3.5 text-muted" aria-hidden="true" />
                    <span>Copy curl</span>
                  </>
                )}
              </button>
            </div>
            <pre className="mt-2 overflow-x-auto rounded-lg border border-border bg-bg p-3 font-mono text-xs leading-relaxed text-fg">
              <code>{BATCH_CURL_EXAMPLE}</code>
            </pre>
          </div>
        </div>
      </section>
    </div>
  );
}
