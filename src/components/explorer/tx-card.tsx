import { useMemo, useState } from "react";
import { ChevronDown, Copy, Check, ExternalLink, ShieldCheck, FileCode } from "lucide-react";
import { shortId } from "@/lib/ledger/hash";
import { cn } from "@/lib/utils";
import type { ApiTx } from "@/lib/networkConstants";
import type { Tx } from "@/lib/ledger/types";
import {
  decodeContractCall,
  formatTimestampDisplay,
  formatAtomsDisplay,
  bytesToHex,
  getTransactionKind,
  type DecodedContractCall,
} from "@/lib/contracts/decoders";

export type TxCardProps = {
  tx: ApiTx | Tx;
};

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-0.5 text-[10px] text-subtle hover:text-fg font-mono transition-colors p-0.5 rounded hover:bg-surface-2"
      title={label ? `Copy ${label}` : "Copy to clipboard"}
    >
      {copied ? <Check className="size-3 text-ok" /> : <Copy className="size-3" />}
      {copied && <span className="text-[9px] text-ok">Copied</span>}
    </button>
  );
}

export function ExplorerTxCard({ tx }: TxCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [showRawHex, setShowRawHex] = useState(false);

  const kind = getTransactionKind(tx);

  const method =
    tx.method ?? (typeof tx.kind === "object" ? tx.kind?.method : undefined) ?? "";

  const rawArgs =
    tx.args ?? (typeof tx.kind === "object" ? tx.kind?.args : undefined) ?? "";

  const contract =
    tx.contract ?? (typeof tx.kind === "object" ? tx.kind?.contract : undefined) ?? "";

  const callValue =
    tx.call_value ??
    tx.value ??
    (typeof tx.kind === "object" ? (tx.kind?.call_value ?? tx.kind?.value) : undefined) ??
    0;

  const gasLimit =
    tx.gas_limit ??
    (typeof tx.kind === "object" ? tx.kind?.gas_limit : undefined);

  const decoded: DecodedContractCall | null = useMemo(() => {
    if (kind !== "Call" || (!rawArgs && !method)) return null;
    return decodeContractCall(method, rawArgs);
  }, [kind, method, rawArgs]);

  // Formatted raw payload string
  const rawHexStr = useMemo(() => {
    if (decoded?.rawHex) return decoded.rawHex;
    if (typeof rawArgs === "string") {
      return rawArgs.startsWith("0x") ? rawArgs.slice(2) : rawArgs;
    }
    if (rawArgs instanceof Uint8Array) {
      return bytesToHex(rawArgs);
    }
    return "";
  }, [decoded, rawArgs]);

  const recipientTo =
    ("to" in tx && typeof tx.to === "string" ? tx.to : undefined) ??
    ("outputs" in tx && tx.outputs && tx.outputs[0]?.owner ? tx.outputs[0].owner : undefined) ??
    (typeof tx.kind === "object" ? tx.kind?.to : undefined);

  const transferAmount =
    ("amount" in tx && typeof tx.amount === "number" ? tx.amount : undefined) ??
    ("outputs" in tx && Array.isArray(tx.outputs) ? tx.outputs.reduce((n, o) => n + o.value, 0) : undefined) ??
    (typeof tx.kind === "object" && typeof tx.kind?.amount === "number" ? tx.kind.amount : 0) ??
    0;

  return (
    <li className="rounded-lg border border-border/70 bg-bg/40 transition-colors hover:border-border overflow-hidden">
      {/* Header bar */}
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-2 p-2.5",
          kind === "Call" && "cursor-pointer hover:bg-surface/40",
        )}
        onClick={() => {
          if (kind === "Call") setExpanded((v) => !v);
        }}
        role={kind === "Call" ? "button" : undefined}
        tabIndex={kind === "Call" ? 0 : undefined}
        onKeyDown={(e) => {
          if (kind === "Call" && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            setExpanded((v) => !v);
          }
        }}
      >
        <div className="flex items-center gap-1.5 font-mono text-[11px]">
          {kind === "Call" && (
            <ChevronDown
              className={cn(
                "size-3.5 text-muted transition-transform duration-150",
                !expanded && "-rotate-90",
              )}
            />
          )}
          <span className="font-semibold text-fg">{shortId(tx.id)}</span>
          <CopyButton text={tx.id} label="Tx Hash" />
        </div>

        <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px]">
          {/* Kind Badge */}
          <span
            className={cn(
              "inline-flex items-center px-1.5 py-0.5 rounded font-medium border",
              kind === "Call" && "bg-amber-500/10 text-amber-400 border-amber-500/30",
              kind === "Deploy" && "bg-purple-500/10 text-purple-400 border-purple-500/30",
              kind === "Transfer" && "bg-blue-500/10 text-blue-400 border-blue-500/30",
              kind === "Coinbase" && "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
            )}
          >
            {kind}
          </span>

          {/* Method Badge for Call transactions */}
          {kind === "Call" && method && (
            <span className="inline-flex items-center rounded-full bg-gold/15 px-2 py-0.5 font-semibold text-gold border border-gold/30">
              {method}
            </span>
          )}

          <span className="text-ok font-medium">Success</span>
        </div>
      </div>

      {/* Summary line for Transfers */}
      {kind === "Transfer" && recipientTo && (
        <div className="border-t border-border/40 bg-surface/20 px-3 py-1.5 text-[11px] font-mono text-muted flex items-center justify-between">
          <span className="flex items-center gap-1">
            <span className="text-subtle">To:</span>
            <span>{shortId(recipientTo)}</span>
            <CopyButton text={recipientTo} label="Recipient Address" />
          </span>
          <span className="text-fg font-semibold">
            {formatAtomsDisplay(BigInt(transferAmount))} KVNC
          </span>
        </div>
      )}

      {/* Summary line for Deploys */}
      {kind === "Deploy" && (
        <div className="border-t border-border/40 bg-surface/20 px-3 py-1.5 text-[11px] font-mono text-muted flex items-center gap-1.5">
          <FileCode className="size-3 text-purple-400" />
          <span>Contract Bytecode Deployment</span>
        </div>
      )}

      {/* Expandable Card for Contract Calls */}
      {kind === "Call" && expanded && (
        <div className="border-t border-border/60 bg-surface/50 p-3 text-xs space-y-3">
          {/* Call Metadata Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] font-mono bg-bg/60 p-2.5 rounded border border-border/50">
            {contract ? (
              <div className="flex flex-col gap-0.5">
                <span className="text-subtle uppercase text-[9px] tracking-wider">Contract</span>
                <span className="text-fg flex items-center gap-1">
                  <span className="break-all">{shortId(contract, 10)}</span>
                  <CopyButton text={contract} label="Contract Address" />
                </span>
              </div>
            ) : null}

            {method ? (
              <div className="flex flex-col gap-0.5">
                <span className="text-subtle uppercase text-[9px] tracking-wider">Method</span>
                <span className="text-gold font-semibold">{method}</span>
              </div>
            ) : null}

            {BigInt(callValue) > 0n ? (
              <div className="flex flex-col gap-0.5">
                <span className="text-subtle uppercase text-[9px] tracking-wider">Call Value</span>
                <span className="text-fg">{formatAtomsDisplay(callValue)} KVNC</span>
              </div>
            ) : null}

            {gasLimit !== undefined ? (
              <div className="flex flex-col gap-0.5">
                <span className="text-subtle uppercase text-[9px] tracking-wider">Gas Limit</span>
                <span className="text-muted">{gasLimit.toString()}</span>
              </div>
            ) : null}
          </div>

          {/* Decoded Arguments Section */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] uppercase font-mono tracking-wider text-subtle font-semibold">
                Decoded Arguments
              </span>
              {decoded?.recognized && (
                <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 font-mono">
                  <ShieldCheck className="size-3 text-emerald-400" />
                  Canonical Wasmi Payload
                </span>
              )}
            </div>

            {decoded && decoded.recognized ? (
              <div className="rounded border border-border bg-bg/80 p-3 text-xs font-mono space-y-2">
                {/* Method 1: name_register */}
                {decoded.method === "name_register" && (
                  <>
                    <div className="flex justify-between items-baseline gap-2">
                      <span className="text-subtle text-[11px]">Name:</span>
                      <strong className="text-fg text-sm font-semibold">{decoded.params.name}</strong>
                    </div>
                    <div className="flex flex-col gap-0.5 pt-1 border-t border-border/40">
                      <span className="text-subtle text-[11px]">Owner Pubkey:</span>
                      <div className="flex items-center gap-1 break-all text-muted text-[11px]">
                        <span>{decoded.params.pubkey}</span>
                        <CopyButton text={decoded.params.pubkey} label="Owner Pubkey" />
                      </div>
                      {decoded.params.pubkeyAddress && (
                        <div className="flex items-center gap-1 text-gold text-[11px]">
                          <span>{decoded.params.pubkeyAddress}</span>
                          <CopyButton text={decoded.params.pubkeyAddress} label="Canonical Address" />
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col gap-1 pt-1 border-t border-border/40">
                      <span className="text-subtle text-[11px]">
                        Relay Endpoints ({decoded.params.relayEndpoints.length}):
                      </span>
                      {decoded.params.relayEndpoints.length === 0 ? (
                        <span className="text-subtle italic text-[11px]">None provided</span>
                      ) : (
                        <ul className="space-y-1 pl-2">
                          {decoded.params.relayEndpoints.map((ep, idx) => (
                            <li key={idx} className="text-fg text-[11px] flex items-center gap-1">
                              <span>•</span>
                              <span className="break-all">{ep}</span>
                              {ep.startsWith("http") && (
                                <a
                                  href={ep}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-subtle hover:text-gold"
                                >
                                  <ExternalLink className="size-2.5" />
                                </a>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </>
                )}

                {/* Method 2: htlc_create */}
                {decoded.method === "htlc_create" && (
                  <>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-subtle text-[11px]">Hashlock:</span>
                      <div className="flex items-center gap-1 break-all text-muted text-[11px]">
                        <span>{decoded.params.hashlock}</span>
                        <CopyButton text={decoded.params.hashlock} label="Hashlock" />
                      </div>
                    </div>
                    <div className="flex justify-between items-baseline gap-2 pt-1 border-t border-border/40">
                      <span className="text-subtle text-[11px]">Timelock / Expiry:</span>
                      <span className="text-fg text-right font-semibold">
                        {formatTimestampDisplay(decoded.params.timelock)}
                      </span>
                    </div>
                    <div className="flex flex-col gap-0.5 pt-1 border-t border-border/40">
                      <span className="text-subtle text-[11px]">Recipient:</span>
                      <div className="flex items-center gap-1 break-all text-muted text-[11px]">
                        <span>{decoded.params.recipient}</span>
                        <CopyButton text={decoded.params.recipient} label="Recipient Pubkey" />
                      </div>
                      {decoded.params.recipientAddress && (
                        <div className="flex items-center gap-1 text-gold text-[11px]">
                          <span>{decoded.params.recipientAddress}</span>
                          <CopyButton text={decoded.params.recipientAddress} label="Recipient Address" />
                        </div>
                      )}
                    </div>
                    {decoded.params.amount !== undefined && (
                      <div className="flex justify-between items-center pt-1 border-t border-border/40">
                        <span className="text-subtle text-[11px]">Amount:</span>
                        <span className="text-fg font-semibold">
                          {formatAtomsDisplay(decoded.params.amount)} KVNC
                        </span>
                      </div>
                    )}
                  </>
                )}

                {/* Method 3: nft_mint */}
                {decoded.method === "nft_mint" && (
                  <>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-subtle text-[11px]">Collection ID:</span>
                      <div className="flex items-center gap-1 break-all text-muted text-[11px]">
                        <span>{decoded.params.collection}</span>
                        <CopyButton text={decoded.params.collection} label="Collection ID" />
                      </div>
                    </div>
                    <div className="flex justify-between items-baseline gap-2 pt-1 border-t border-border/40">
                      <span className="text-subtle text-[11px]">Token ID:</span>
                      <span className="text-gold font-bold text-sm">#{decoded.params.tokenId.toString()}</span>
                    </div>
                    <div className="flex flex-col gap-0.5 pt-1 border-t border-border/40">
                      <span className="text-subtle text-[11px]">Recipient (To):</span>
                      <div className="flex items-center gap-1 break-all text-muted text-[11px]">
                        <span>{decoded.params.to}</span>
                        <CopyButton text={decoded.params.to} label="Recipient Pubkey" />
                      </div>
                      {decoded.params.toAddress && (
                        <div className="flex items-center gap-1 text-gold text-[11px]">
                          <span>{decoded.params.toAddress}</span>
                          <CopyButton text={decoded.params.toAddress} label="Recipient Address" />
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col gap-0.5 pt-1 border-t border-border/40">
                      <span className="text-subtle text-[11px]">Token URI:</span>
                      <div className="flex items-center gap-1 break-all text-fg text-[11px]">
                        <span>{decoded.params.tokenUri}</span>
                        <CopyButton text={decoded.params.tokenUri} label="Token URI" />
                        {decoded.params.tokenUri.startsWith("http") && (
                          <a
                            href={decoded.params.tokenUri}
                            target="_blank"
                            rel="noreferrer"
                            className="text-subtle hover:text-gold"
                          >
                            <ExternalLink className="size-2.5" />
                          </a>
                        )}
                      </div>
                    </div>
                  </>
                )}

                {/* Method 4: escrow_create */}
                {decoded.method === "escrow_create" && (
                  <>
                    <div className="flex justify-between items-baseline gap-2">
                      <span className="text-subtle text-[11px]">Threshold:</span>
                      <span className="text-fg font-semibold">
                        {decoded.params.threshold} of {decoded.params.parties.length} Signatures
                      </span>
                    </div>
                    <div className="flex justify-between items-baseline gap-2 pt-1 border-t border-border/40">
                      <span className="text-subtle text-[11px]">Escrow Amount:</span>
                      <span className="text-fg font-semibold">
                        {formatAtomsDisplay(decoded.params.amount)} KVNC
                      </span>
                    </div>
                    <div className="flex justify-between items-baseline gap-2 pt-1 border-t border-border/40">
                      <span className="text-subtle text-[11px]">Deadline:</span>
                      <span className="text-fg text-right font-medium">
                        {formatTimestampDisplay(decoded.params.deadline)}
                      </span>
                    </div>
                    <div className="flex flex-col gap-1 pt-1 border-t border-border/40">
                      <span className="text-subtle text-[11px]">
                        Parties ({decoded.params.parties.length}):
                      </span>
                      <ul className="space-y-1 pl-2">
                        {decoded.params.parties.map((p, idx) => (
                          <li key={idx} className="flex items-center gap-1 text-[11px] text-muted">
                            <span className="text-subtle">#{idx + 1}</span>
                            <span className="break-all">{shortId(p, 10)}</span>
                            <CopyButton text={p} label={`Party #${idx + 1}`} />
                          </li>
                        ))}
                      </ul>
                    </div>
                  </>
                )}

                {/* Method 5: token_transfer */}
                {decoded.method === "token_transfer" && (
                  <>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-subtle text-[11px]">Recipient (To):</span>
                      <div className="flex items-center gap-1 break-all text-muted text-[11px]">
                        <span>{decoded.params.to}</span>
                        <CopyButton text={decoded.params.to} label="Recipient" />
                      </div>
                      {decoded.params.toAddress && (
                        <div className="flex items-center gap-1 text-gold text-[11px]">
                          <span>{decoded.params.toAddress}</span>
                          <CopyButton text={decoded.params.toAddress} label="Recipient Address" />
                        </div>
                      )}
                    </div>
                    <div className="flex justify-between items-baseline gap-2 pt-1 border-t border-border/40">
                      <span className="text-subtle text-[11px]">Transfer Amount:</span>
                      <span className="text-fg font-bold text-sm">
                        {decoded.params.amount.toString()} tokens
                      </span>
                    </div>
                  </>
                )}

                {/* Method 6: vault_create */}
                {decoded.method === "vault_create" && (
                  <>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-subtle text-[11px]">Owner / Beneficiary:</span>
                      <div className="flex items-center gap-1 break-all text-muted text-[11px]">
                        <span>{decoded.params.owner}</span>
                        <CopyButton text={decoded.params.owner} label="Beneficiary" />
                      </div>
                      {decoded.params.ownerAddress && (
                        <div className="flex items-center gap-1 text-gold text-[11px]">
                          <span>{decoded.params.ownerAddress}</span>
                          <CopyButton text={decoded.params.ownerAddress} label="Beneficiary Address" />
                        </div>
                      )}
                    </div>
                    <div className="flex justify-between items-baseline gap-2 pt-1 border-t border-border/40">
                      <span className="text-subtle text-[11px]">Lock Until:</span>
                      <span className="text-fg text-right font-semibold">
                        {formatTimestampDisplay(decoded.params.lockUntil)}
                      </span>
                    </div>
                    {decoded.params.amount !== undefined && (
                      <div className="flex justify-between items-baseline gap-2 pt-1 border-t border-border/40">
                        <span className="text-subtle text-[11px]">Vault Amount:</span>
                        <span className="text-fg font-semibold">
                          {formatAtomsDisplay(decoded.params.amount)} KVNC
                        </span>
                      </div>
                    )}
                  </>
                )}

                {/* Method 7: multisig_create */}
                {decoded.method === "multisig_create" && (
                  <>
                    <div className="flex justify-between items-baseline gap-2">
                      <span className="text-subtle text-[11px]">Threshold:</span>
                      <span className="text-fg font-semibold">
                        {decoded.params.threshold} of {decoded.params.owners.length}
                      </span>
                    </div>
                    <div className="flex flex-col gap-1 pt-1 border-t border-border/40">
                      <span className="text-subtle text-[11px]">
                        Owners ({decoded.params.owners.length}):
                      </span>
                      <ul className="space-y-1 pl-2">
                        {decoded.params.owners.map((o, idx) => (
                          <li key={idx} className="flex items-center gap-1 text-[11px] text-muted">
                            <span className="text-subtle">#{idx + 1}</span>
                            <span className="break-all">{shortId(o, 10)}</span>
                            <CopyButton text={o} label={`Owner #${idx + 1}`} />
                          </li>
                        ))}
                      </ul>
                    </div>
                  </>
                )}
              </div>
            ) : (
              /* Fallback when decoding is unrecognized or fails */
              <div className="rounded border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs font-mono space-y-1.5">
                <div className="text-amber-300 font-semibold text-[11px]">
                  Unrecognized Contract Call / Raw Binary Arguments
                </div>
                <p className="text-subtle text-[10px]">
                  The payload could not be parsed as a canonical Wasmi entry point. Raw arguments:
                </p>
                <div className="p-2 rounded bg-bg/80 border border-border/40 text-[11px] text-fg break-all font-mono select-all">
                  0x{rawHexStr || "none"}
                </div>
              </div>
            )}
          </div>

          {/* Collapsible raw hex inspector (even for recognized calls) */}
          {decoded?.recognized && rawHexStr && (
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setShowRawHex((v) => !v)}
                className="text-[10px] font-mono text-subtle hover:text-fg transition-colors flex items-center gap-1"
              >
                <ChevronDown
                  className={cn("size-3 transition-transform", !showRawHex && "-rotate-90")}
                />
                <span>{showRawHex ? "Hide" : "Inspect"} Raw Wire Hex (0x...)</span>
              </button>
              {showRawHex && (
                <div className="mt-1.5 p-2 rounded bg-bg/90 border border-border/50 font-mono text-[10px] text-muted break-all flex items-start justify-between gap-2">
                  <span className="select-all">0x{rawHexStr}</span>
                  <CopyButton text={`0x${rawHexStr}`} label="Raw Payload Hex" />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}
