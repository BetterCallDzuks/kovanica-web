import { useEffect, useState } from "react";
import { api, useApiSource } from "@/lib/api/client";
import { type ApiHead } from "@/lib/api/contract";
import { shortId } from "@/lib/ledger/hash";
import { healthLabel } from "@/lib/api/health";

/**
 * LiveStats — compact live-network strip for marketing surfaces.
 * Client-only, polls /api/head every 5s, renders nothing on SSR.
 * Degrades to hidden when offline or when the source has no endpoint.
 */
export function LiveStats() {
  const source = useApiSource();
  const [head, setHead] = useState<ApiHead | null>(null);

  useEffect(() => {
    if (source === "mainnet") {
      setHead(null);
      return;
    }
    let alive = true;
    const load = async () => {
      try {
        const h = await api<ApiHead>("/api/head");
        if (alive) setHead(h);
      } catch {
        // marketing strip degrades gracefully
      }
    };
    void load();
    const id = window.setInterval(() => void load(), 5_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [source]);

  if (!head) return null;

  // Height and tip are read from seed1; min fee and target are protocol spec.
  const cells = [
    { label: "Committed height", value: head.blocks.toLocaleString() },
    { label: "Tip", value: head.tip ? shortId(head.tip) : "n/a" },
    { label: "Min fee · spec", value: `${head.min_fee.toLocaleString()} atoms` },
    { label: "Target · spec", value: "4 s" },
  ];
  const state = head.health?.state;

  return (
    <div className="w-full">
      <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-4">
        {cells.map((c) => (
          <div
            key={c.label}
            className="rounded-xl border border-border bg-surface/60 px-4 py-3 text-center backdrop-blur-sm"
          >
            <p className="font-mono text-[10px] tracking-brand text-subtle uppercase">
              {c.label}
            </p>
            <p className="mt-1 truncate font-mono text-sm text-fg">{c.value}</p>
          </div>
        ))}
      </div>
      {state && state !== "live" && (
        <p className="mt-2 text-center font-mono text-[10px] tracking-wide text-amber-300 uppercase">
          {healthLabel(state)} · last committed state
        </p>
      )}
    </div>
  );
}