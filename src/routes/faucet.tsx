import { useMemo, useState, type FormEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ShieldAlert, ShieldCheck, Shield } from "lucide-react";
import { FaucetView } from "@/components/faucet/faucet-view";
import { Shell } from "@/components/layout/shell";
import {
  FAUCET_CANONICAL_NETWORK_TAG,
  FAUCET_CHAIN_ID,
  formatCooldownRemaining,
  validateFaucetAddress,
} from "@/lib/faucet/faucet-telemetry";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/faucet")({ component: FaucetPage });

function FaucetPage() {
  const [recipientInput, setRecipientInput] = useState("");

  const trimmed = recipientInput.trim();
  const verdict = useMemo(
    () => (trimmed.length > 0 ? validateFaucetAddress(trimmed) : null),
    [trimmed],
  );

  const preflightState = verdict === null ? "idle" : verdict.ok ? "valid" : "invalid";

  function handleContainerInput(event: FormEvent<HTMLDivElement>) {
    const target = event.target as HTMLInputElement | null;
    if (target && target.id === "faucet-address") {
      setRecipientInput(target.value);
    }
  }

  return (
    <Shell>
      <div onInput={handleContainerInput} className="flex flex-1 flex-col bg-bg text-fg">
      <section
        aria-label="Faucet pre-flight guard"
        className="border-b border-border bg-surface/80 px-4 py-2.5 backdrop-blur-sm"
      >
        <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span
              data-testid="faucet-network-tag-badge"
              className="inline-flex items-center gap-1.5 rounded-full border border-blue/30 bg-blue/10 px-2.5 py-0.5 font-mono text-[11px] font-medium text-blue"
            >
              <span>Chain {FAUCET_CHAIN_ID}</span>
              <span aria-hidden="true">·</span>
              <span>{FAUCET_CANONICAL_NETWORK_TAG}</span>
            </span>
            <span className="font-mono text-[11px] text-subtle">
              Cooldown: {formatCooldownRemaining(0)}
            </span>
          </div>

          <div
            data-testid="faucet-preflight-status"
            data-preflight-state={preflightState}
            data-network-tag={FAUCET_CANONICAL_NETWORK_TAG}
            className={cn(
              "inline-flex max-w-full items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[11px]",
              preflightState === "valid"
                ? "border-ok/40 bg-ok/10 text-ok"
                : preflightState === "invalid"
                  ? "border-danger/40 bg-danger/10 text-danger"
                  : "border-border bg-bg text-muted",
            )}
          >
            {preflightState === "valid" ? (
              <ShieldCheck className="size-3.5 shrink-0" aria-hidden="true" />
            ) : preflightState === "invalid" ? (
              <ShieldAlert className="size-3.5 shrink-0" aria-hidden="true" />
            ) : (
              <Shield className="size-3.5 shrink-0" aria-hidden="true" />
            )}
            <span className="truncate">
              {preflightState === "idle"
                ? "PRO-21 pre-flight ready (kvnc…dag / tknc…dag)"
                : verdict?.ok
                  ? `PRO-21 checksum verified (${verdict.format})`
                  : verdict?.reason}
            </span>
          </div>
        </div>
      </section>

      <FaucetView />
      </div>
    </Shell>
  );
}
