import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  FileJson,
  Lock,
  ShieldAlert,
  ShieldCheck,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  createSampleMultisigBundleJson,
  getMultisigChainLabel,
  parseMultisigBundleJson,
} from "@/lib/multisig/airgap-quorum";

function truncateMiddle(value: string, head = 14, tail = 10): string {
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function AirgapQuorumInspector() {
  const [rawJson, setRawJson] = useState("");

  const parsed = useMemo(() => {
    if (!rawJson.trim()) return null;
    return parseMultisigBundleJson(rawJson);
  }, [rawJson]);

  function onLoadSample(variant: "pending" | "quorum") {
    setRawJson(createSampleMultisigBundleJson(variant));
  }

  function onCopySanitized() {
    if (!parsed || !parsed.ok) return;
    void navigator.clipboard
      .writeText(parsed.sanitizedJson)
      .then(() => toast.success("Sanitized bundle JSON copied"))
      .catch(() => toast.error("Could not copy to clipboard"));
  }

  function onDownloadSanitized() {
    if (!parsed || !parsed.ok) return;
    const blob = new Blob([parsed.sanitizedJson], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const safeId = parsed.bundle.proposalId.replace(/[^a-zA-Z0-9._-]/g, "_");
    link.href = url;
    link.download = `kovanica-multisig-${safeId}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast.success("Sanitized bundle JSON downloaded");
  }

  return (
    <section
      aria-label="Air-Gapped Multisig Proposal Inspector"
      className="rounded-xl border border-border bg-surface p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-lg tracking-tight text-fg">
              Air-Gapped Proposal Inspector
            </h2>
            <span className="inline-flex items-center gap-1 rounded-full border border-ok/30 bg-ok/10 px-2.5 py-0.5 font-mono text-[10px] font-medium tracking-wider text-ok uppercase">
              <Lock className="size-3" />
              READ-ONLY · ZERO SECRETS
            </span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Inspect <code className="font-mono text-fg">kovanica-multisig-bundle-v1</code> JSON
            offline, verify PRO-21 signers and quorum progress, and export sanitized bundles.
            Secret keys, seeds, and mnemonics are strictly rejected.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onLoadSample("pending")}
          >
            <FileJson className="size-3.5" />
            Sample (1/2)
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onLoadSample("quorum")}
          >
            <ShieldCheck className="size-3.5" />
            Sample (2/2)
          </Button>
          {rawJson.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Clear bundle JSON"
              onClick={() => setRawJson("")}
            >
              <X className="size-3.5" />
              Clear
            </Button>
          )}
        </div>
      </div>

      <div className="mt-4">
        <label
          htmlFor="airgap-multisig-bundle-input"
          className="block text-[10px] tracking-wide text-subtle uppercase"
        >
          Bundle JSON (kovanica-multisig-bundle-v1)
        </label>
        <textarea
          id="airgap-multisig-bundle-input"
          value={rawJson}
          onChange={(e) => setRawJson(e.target.value)}
          placeholder='{"format":"kovanica-multisig-bundle-v1","version":1,"chainId":1,"multisigAddress":"kvnc...dag","proposalId":"...","threshold":2,"signers":[...],"approvals":[...]}'
          rows={6}
          spellCheck={false}
          className="mt-2 min-h-28 w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-xs text-fg outline-none focus-visible:shadow-[var(--shadow-border-hover)]"
        />
      </div>

      {parsed && !parsed.ok && (
        <div
          role="alert"
          className="mt-4 flex items-start gap-2.5 rounded-lg border border-danger/40 bg-danger/10 p-3 text-xs text-danger"
        >
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0">
            <p className="font-medium">Bundle validation failed</p>
            <p className="mt-0.5 break-words font-mono text-[11px]">{parsed.error}</p>
          </div>
        </div>
      )}

      {parsed && parsed.ok && (
        <div className="mt-5 flex flex-col gap-4">
          {/* Quorum Progress Bar */}
          <div className="rounded-lg border border-border bg-surface-2 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {parsed.quorum.quorumReached ? (
                  <CheckCircle2 className="size-4 text-ok" />
                ) : (
                  <Clock className="size-4 text-gold" />
                )}
                <span className="text-xs font-medium text-fg">
                  Quorum Progress:{" "}
                  <span className="font-mono">
                    {parsed.quorum.approvedCount} / {parsed.quorum.threshold}
                  </span>{" "}
                  approvals
                </span>
              </div>
              <span
                className={cn(
                  "rounded-full px-2.5 py-0.5 font-mono text-[11px] font-medium",
                  parsed.quorum.quorumReached
                    ? "bg-ok/15 text-ok"
                    : "bg-gold/15 text-gold",
                )}
              >
                {parsed.quorum.quorumReached
                  ? "Quorum reached"
                  : `${parsed.quorum.remainingNeeded} more needed`}
              </span>
            </div>

            <div
              role="progressbar"
              aria-label="Multisig quorum progress"
              aria-valuemin={0}
              aria-valuemax={parsed.quorum.threshold}
              aria-valuenow={Math.min(parsed.quorum.approvedCount, parsed.quorum.threshold)}
              className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-bg"
            >
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-300",
                  parsed.quorum.quorumReached ? "bg-ok" : "bg-gold",
                )}
                style={{ width: `${parsed.quorum.progressPercent}%` }}
              />
            </div>

            <div className="mt-2 flex items-center justify-between text-[11px] text-muted">
              <span>
                {parsed.quorum.uniqueSigners.length} authorized signers ·{" "}
                {parsed.bundle.threshold}-of-{parsed.quorum.uniqueSigners.length} policy
              </span>
              <span className="font-mono">{parsed.quorum.progressPercent}%</span>
            </div>
          </div>

          {/* Proposal Metadata */}
          <dl className="grid grid-cols-1 gap-2 rounded-lg border border-border bg-bg/60 p-3 text-xs sm:grid-cols-2">
            <div>
              <dt className="text-[10px] tracking-wide text-subtle uppercase">Proposal ID</dt>
              <dd className="mt-0.5 break-all font-mono text-fg">{parsed.bundle.proposalId}</dd>
            </div>
            <div>
              <dt className="text-[10px] tracking-wide text-subtle uppercase">Network</dt>
              <dd className="mt-0.5 font-mono text-fg">
                {getMultisigChainLabel(parsed.bundle.chainId)}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-[10px] tracking-wide text-subtle uppercase">Multisig Address</dt>
              <dd className="mt-0.5 break-all font-mono text-[11px] text-fg">
                {parsed.bundle.multisigAddress}
              </dd>
            </div>
            {parsed.bundle.description && (
              <div className="sm:col-span-2">
                <dt className="text-[10px] tracking-wide text-subtle uppercase">Description</dt>
                <dd className="mt-0.5 text-fg">{parsed.bundle.description}</dd>
              </div>
            )}
            {parsed.bundle.payloadHex && (
              <div className="sm:col-span-2">
                <dt className="text-[10px] tracking-wide text-subtle uppercase">Payload Hex</dt>
                <dd className="mt-0.5 break-all font-mono text-[11px] text-muted">
                  {parsed.bundle.payloadHex}
                </dd>
              </div>
            )}
          </dl>

          {/* Signer Approvals */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-border bg-bg/40 p-3">
              <p className="text-[10px] tracking-wide text-ok uppercase">
                Valid approvals ({parsed.quorum.validApprovals.length})
              </p>
              {parsed.quorum.validApprovals.length === 0 ? (
                <p className="mt-2 text-xs text-muted">No authorized signer approvals yet.</p>
              ) : (
                <ul className="mt-2 flex flex-col gap-1.5">
                  {parsed.quorum.validApprovals.map((signer) => (
                    <li
                      key={signer}
                      title={signer}
                      className="flex items-center gap-1.5 font-mono text-[11px] text-fg"
                    >
                      <CheckCircle2 className="size-3.5 shrink-0 text-ok" />
                      <span className="truncate">{truncateMiddle(signer)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-lg border border-border bg-bg/40 p-3">
              <p className="text-[10px] tracking-wide text-subtle uppercase">
                Awaiting signature ({parsed.quorum.pendingSigners.length})
              </p>
              {parsed.quorum.pendingSigners.length === 0 ? (
                <p className="mt-2 text-xs text-muted">All authorized signers have signed.</p>
              ) : (
                <ul className="mt-2 flex flex-col gap-1.5">
                  {parsed.quorum.pendingSigners.map((signer) => (
                    <li
                      key={signer}
                      title={signer}
                      className="flex items-center gap-1.5 font-mono text-[11px] text-muted"
                    >
                      <Clock className="size-3.5 shrink-0 text-subtle" />
                      <span className="truncate">{truncateMiddle(signer)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Warnings for Duplicate or Unknown Approvers */}
          {(parsed.quorum.duplicateApprovals.length > 0 ||
            parsed.quorum.unknownApprovals.length > 0) && (
            <div className="flex flex-col gap-2 rounded-lg border border-gold/40 bg-gold/10 p-3 text-xs">
              <div className="flex items-center gap-2 font-medium text-gold">
                <AlertTriangle className="size-4 shrink-0" />
                <span>Approval warnings detected</span>
              </div>

              {parsed.quorum.duplicateApprovals.length > 0 && (
                <div>
                  <p className="text-[11px] font-medium text-fg">
                    Duplicate approvals ({parsed.quorum.duplicateApprovals.length} — counted once):
                  </p>
                  <ul className="mt-1 flex flex-col gap-0.5 font-mono text-[11px] text-muted">
                    {parsed.quorum.duplicateApprovals.map((addr) => (
                      <li key={`dup-${addr}`} className="break-all">
                        {addr}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {parsed.quorum.unknownApprovals.length > 0 && (
                <div>
                  <p className="text-[11px] font-medium text-fg">
                    Unknown approvers ({parsed.quorum.unknownApprovals.length} — not in signer set):
                  </p>
                  <ul className="mt-1 flex flex-col gap-0.5 font-mono text-[11px] text-muted">
                    {parsed.quorum.unknownApprovals.map((addr) => (
                      <li key={`unk-${addr}`} className="break-all">
                        {addr}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Sanitized Export Actions */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
            <p className="text-[11px] text-muted">
              Export contains strictly public proposal &amp; signature fields.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={onCopySanitized}>
                <Copy className="size-3.5" />
                Copy sanitized JSON
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={onDownloadSanitized}>
                <Download className="size-3.5" />
                Export JSON
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
