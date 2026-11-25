import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Upload,
  Loader2,
  Gem,
  Sparkles,
  Wallet,
  Copy,
  ExternalLink,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api/client";
import { shortId } from "@/lib/ledger/hash";
import { hexToKvnc, parseAddr } from "@/lib/wallet/address";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { IpfsMetadataUpload } from "@/components/wallet/ipfs-upload";
import { computeMetadataHash, createRwaMetadata } from "@/lib/rwa/metadata";
import { ATOM, FIXED_FEES, TOKEN } from "@/lib/networkConstants";
import { useLedger } from "@/lib/ledger/store";
import {
  connectExtensionSigner,
  deployAndIssueRwa,
  deriveRwaAssetId,
  getKovanicaExtension,
  webWalletSigner,
  type ActiveSigner,
  type IssueRwaResult,
} from "@/lib/wallet/tx-builder";

const ASSET_CLASSES = [
  { value: "RE", label: "Real Estate (RE)" },
  { value: "BOND", label: "Bond (BOND)" },
  { value: "INVOICE", label: "Invoice (INVOICE)" },
  { value: "COMMODITY", label: "Commodity (COMMODITY)" },
  { value: "FUND", label: "Fund (FUND)" },
  { value: "OTHER", label: "Other (OTHER)" },
] as const;

type RwaAssetClass = (typeof ASSET_CLASSES)[number]["value"];

async function loader() {
  return {};
}

export const Route = createFileRoute("/wallet/rwa-issue")({
  loader,
  component: RwaIssuePage,
});

function RwaIssuePage() {
  const wallet = useLedger((s) => s.wallet);
  const [step, setStep] = useState<"derive" | "mint" | "success">("derive");
  const [extSigner, setExtSigner] = useState<ActiveSigner | null>(null);

  // Derive step state
  const [issuer, setIssuer] = useState("");
  const [assetName, setAssetName] = useState("");
  const [assetSymbol, setAssetSymbol] = useState("");
  const [assetClass, setAssetClass] = useState<RwaAssetClass>("RE");
  const [uniqueId, setUniqueId] = useState("");
  const [version, setVersion] = useState("1");
  const [jurisdiction, setJurisdiction] = useState("RS");
  const [derivedAssetId, setDerivedAssetId] = useState<string | null>(null);
  const [deriving, setDeriving] = useState(false);

  // Mint step state
  const [amount, setAmount] = useState("100");
  const [maxSupply, setMaxSupply] = useState("0");
  const [to, setTo] = useState("");
  const [metadataUriInput, setMetadataUriInput] = useState("");
  const [legalUri, setLegalUri] = useState("");
  const [custodyUri, setCustodyUri] = useState("");
  const [metadataCid, setMetadataCid] = useState<string | null>(null);
  const [minting, setMinting] = useState(false);
  const [mintStatus, setMintStatus] = useState<string | null>(null);

  // Success step state
  const [issuedResult, setIssuedResult] = useState<IssueRwaResult | null>(null);

  const unlockedSigner = useMemo(() => webWalletSigner(wallet), [wallet]);
  const activeSigner = unlockedSigner ?? extSigner;
  const hasExtension = useMemo(() => getKovanicaExtension() !== null, []);

  // Auto pre-fill Issuer & Recipient from active wallet
  useEffect(() => {
    const activeAddr = activeSigner?.addressKvnc ?? (wallet?.address ? hexToKvnc(wallet.address) : "");
    if (!activeAddr) return;
    if (!issuer) setIssuer(activeAddr);
    if (!to) setTo(activeAddr);
  }, [activeSigner, issuer, to, wallet?.address]);

  const handleConnectExtension = async () => {
    try {
      const signer = await connectExtensionSigner();
      setExtSigner(signer);
      setIssuer(signer.addressKvnc);
      setTo(signer.addressKvnc);
      toast.success(`Connected ${shortId(signer.addressKvnc)}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Extension connection failed");
    }
  };

  // Derive asset_id from issuer
  const handleDerive = async () => {
    const issuerHex = parseAddr(issuer.trim());
    if (!issuerHex) {
      toast.error("Enter a valid issuer address (kvnc…dag or 64-hex)");
      return;
    }
    if (!assetClass || !uniqueId.trim()) {
      toast.error("Fill in issuer, asset class, and unique ID");
      return;
    }
    const verNum = Number.parseInt(version.trim(), 10);
    if (!Number.isInteger(verNum) || verNum < 1) {
      toast.error("Version must be a positive integer");
      return;
    }

    setDeriving(true);
    try {
      let derivedId: string;
      try {
        const res = await api<{ asset_id: string; asset_id_kvnc: string }>(
          `/api/rwa/derive?issuer=${encodeURIComponent(issuerHex)}&class=${encodeURIComponent(assetClass)}&id=${encodeURIComponent(uniqueId)}&version=${encodeURIComponent(String(verNum))}`,
          "POST",
        );
        derivedId = res.asset_id;
      } catch {
        // Fallback to identical client-side BLAKE3 derivation
        derivedId = deriveRwaAssetId(issuerHex, assetClass, uniqueId, verNum).assetIdHex;
      }
      setDerivedAssetId(derivedId);
      if (!to) setTo(issuer);
      setStep("mint");
      toast.success("Asset ID derived successfully");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to derive asset ID");
    } finally {
      setDeriving(false);
    }
  };

  // Sign & broadcast real RWA issuance on Testnet Chain 2
  const handleIssueAndMint = async () => {
    if (!derivedAssetId) {
      toast.error("No asset ID derived yet");
      return;
    }
    if (!activeSigner) {
      toast.error("Unlock your Web Wallet on /wallet or connect window.kovanica to sign");
      return;
    }
    const dest = parseAddr(to.trim());
    if (!dest) {
      toast.error("Need a valid kvnc…dag or 64-hex recipient address");
      return;
    }
    if (!/^\d+$/.test(amount.trim()) || BigInt(amount.trim()) <= 0n) {
      toast.error("Enter a positive whole-unit initial supply");
      return;
    }
    const initialUnits = BigInt(amount.trim());
    const maxUnits = /^\d+$/.test(maxSupply.trim()) ? BigInt(maxSupply.trim()) : 0n;
    if (maxUnits > 0n && initialUnits > maxUnits) {
      toast.error("Initial supply cannot exceed max supply");
      return;
    }

    const cleanJurisdiction = jurisdiction.trim().toUpperCase();
    if (cleanJurisdiction && cleanJurisdiction.length !== 2) {
      toast.error("Jurisdiction must be a 2-letter ISO code (e.g. RS, US, DE) or blank");
      return;
    }

    setMinting(true);
    setMintStatus("Computing canonical KVP-106 metadata hash…");
    try {
      const resolvedName = assetName.trim() || `RWA ${assetClass} ${uniqueId.trim()}`;
      const resolvedSymbol =
        assetSymbol.trim().toUpperCase() ||
        `${assetClass}${uniqueId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6).toUpperCase() || "RWA"}`;

      const explicitUri = metadataUriInput.trim();
      const chosenUri = explicitUri || (metadataCid ? `ipfs://${metadataCid}` : "");

      const metadata = createRwaMetadata({
        name: resolvedName,
        description: `KVP-106 RWA (${assetClass}) — ${uniqueId.trim()}`,
        image: chosenUri || "https://kovanica.online/icon-192.png",
        asset_class: assetClass,
        legal_uri: legalUri.trim() || undefined,
        custody_uri: custodyUri.trim() || undefined,
        total_supply: initialUnits.toString(),
        jurisdiction: cleanJurisdiction || undefined,
      });

      const metadataHashHex = await computeMetadataHash(metadata);
      // Support direct https:// / ipfs:// URLs OR automatic inline JSON hash fallback when IPFS upload is unavailable
      const finalMetadataUri = chosenUri || `inline:sha256:${metadataHashHex}`;

      const decimals = 0;
      const result = await deployAndIssueRwa(activeSigner, {
        name: resolvedName,
        symbol: resolvedSymbol,
        assetClass,
        uniqueId: uniqueId.trim(),
        version: Number.parseInt(version.trim(), 10) || 1,
        jurisdiction: cleanJurisdiction,
        metadataHashHex,
        metadataUri: finalMetadataUri,
        legalUri: legalUri.trim(),
        custodyUri: custodyUri.trim(),
        decimals,
        maxSupplyAtoms: maxUnits,
        initialSupplyAtoms: initialUnits,
        recipient: dest,
        onStatus: (msg) => setMintStatus(msg),
      });

      setIssuedResult(result);
      setMintStatus(null);
      setStep("success");
      toast.success("KVP-106 RWA issued on Testnet!");
    } catch (err) {
      setMintStatus(null);
      toast.error(err instanceof Error ? err.message : "RWA issuance failed");
    } finally {
      setMinting(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-6 md:px-6 md:py-8">
      <div className="mb-6 flex items-center gap-3">
        <Link
          to="/wallet"
          className="text-muted hover:text-fg transition-colors"
          aria-label="Back to wallet"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <p className="font-mono text-[10px] tracking-wide text-purple-400 uppercase">KVP-106 RWA</p>
          <h1 className="font-display text-2xl tracking-tight text-fg">Issue RWA Asset</h1>
        </div>
      </div>

      {/* Signer bar */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3.5 py-2.5 text-xs">
        {activeSigner ? (
          <div className="flex items-center gap-2 min-w-0">
            <span className="size-2 shrink-0 rounded-full bg-emerald-400" />
            <span className="text-muted">
              Signer ({activeSigner.kind === "web-wallet" ? "Web Wallet" : "window.kovanica"}):
            </span>
            <code className="truncate font-mono text-fg">{shortId(activeSigner.addressKvnc)}</code>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-muted">
            <Wallet className="size-3.5 text-gold" />
            <span>Unlock your Web Wallet or connect window.kovanica to sign RWA issuance.</span>
          </div>
        )}
        <div className="flex items-center gap-2">
          {!activeSigner && hasExtension && (
            <Button type="button" size="sm" variant="outline" onClick={() => void handleConnectExtension()}>
              Connect Extension
            </Button>
          )}
          {!activeSigner && (
            <Button asChild size="sm" variant="outline">
              <Link to="/wallet">Unlock Wallet</Link>
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-6">
        {/* Progress indicator */}
        <div className="flex items-center justify-between">
          <div
            className={cn(
              "flex items-center gap-2",
              step === "derive" ? "text-purple-400" : "text-muted",
            )}
          >
            <span
              className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium",
                step === "derive" ? "bg-purple-600 text-white" : "bg-border text-muted",
              )}
            >
              1
            </span>
            <span className="font-mono text-xs text-subtle">Derive</span>
          </div>
          <div className="hidden md:block flex-1 h-px bg-border mx-2" />
          <div
            className={cn(
              "flex items-center gap-2",
              step === "mint" ? "text-purple-400" : "text-muted",
            )}
          >
            <span
              className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium",
                step === "mint" ? "bg-purple-600 text-white" : "bg-border text-muted",
              )}
            >
              2
            </span>
            <span className="font-mono text-xs text-subtle">Sign &amp; Issue</span>
          </div>
          <div className="hidden md:block flex-1 h-px bg-border mx-2" />
          <div
            className={cn(
              "flex items-center gap-2",
              step === "success" ? "text-emerald-400" : "text-muted",
            )}
          >
            <span
              className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium",
                step === "success" ? "bg-emerald-600 text-white" : "bg-border text-muted",
              )}
            >
              3
            </span>
            <span className="font-mono text-xs text-subtle">Done</span>
          </div>
        </div>

        {/* Step 1: Derive Asset ID */}
        {step === "derive" && (
          <div className="rounded-xl border border-border bg-surface p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Gem className="size-5 text-purple-400" />
              <h2 className="font-medium text-fg">Derive Asset ID</h2>
            </div>
            <p className="text-sm text-muted">
              Your active wallet address is pre-filled as Issuer. These parameters deterministically
              derive the KVP-106 <code className="text-fg">asset_id</code> (RFC-007).
            </p>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="text-xs text-muted block mb-1">
                  Issuer Address (kvnc…dag or 64-hex)
                </label>
                <input
                  value={issuer}
                  onChange={(e) => setIssuer(e.target.value)}
                  placeholder="kvnc…dag or 64-hex Ed25519 public key"
                  className="w-full h-11 rounded-md border border-border bg-bg px-3 font-mono text-sm text-fg outline-none"
                />
              </div>

              <div>
                <label className="text-xs text-muted block mb-1">Asset Name</label>
                <input
                  value={assetName}
                  onChange={(e) => setAssetName(e.target.value)}
                  placeholder="e.g. Belgrade Tower 12A"
                  className="w-full h-11 rounded-md border border-border bg-bg px-3 text-sm text-fg outline-none"
                  maxLength={128}
                />
              </div>

              <div>
                <label className="text-xs text-muted block mb-1">Symbol</label>
                <input
                  value={assetSymbol}
                  onChange={(e) => setAssetSymbol(e.target.value.toUpperCase())}
                  placeholder="e.g. BGT12A"
                  className="w-full h-11 rounded-md border border-border bg-bg px-3 font-mono text-sm text-fg outline-none"
                  maxLength={32}
                />
              </div>

              <div>
                <label className="text-xs text-muted block mb-1">Asset Class</label>
                <select
                  value={assetClass}
                  onChange={(e) => setAssetClass(e.target.value as RwaAssetClass)}
                  className="w-full h-11 rounded-md border border-border bg-bg px-3 font-mono text-sm text-fg outline-none"
                >
                  {ASSET_CLASSES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs text-muted block mb-1">Jurisdiction (ISO-2)</label>
                <input
                  value={jurisdiction}
                  onChange={(e) => setJurisdiction(e.target.value.toUpperCase())}
                  placeholder="RS"
                  className="w-full h-11 rounded-md border border-border bg-bg px-3 font-mono text-sm text-fg outline-none"
                  maxLength={2}
                />
              </div>

              <div>
                <label className="text-xs text-muted block mb-1">Unique ID</label>
                <input
                  value={uniqueId}
                  onChange={(e) => setUniqueId(e.target.value)}
                  placeholder="e.g. tower-12a, bond-2026-001"
                  className="w-full h-11 rounded-md border border-border bg-bg px-3 font-mono text-sm text-fg outline-none"
                />
              </div>

              <div>
                <label className="text-xs text-muted block mb-1">Version</label>
                <input
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  placeholder="1"
                  className="w-full h-11 rounded-md border border-border bg-bg px-3 font-mono text-sm text-fg outline-none"
                  maxLength={4}
                />
              </div>
            </div>

            <Button
              onClick={() => void handleDerive()}
              disabled={deriving || !issuer || !assetClass || !uniqueId}
              className="w-full h-12"
            >
              {deriving ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  Deriving…
                </>
              ) : (
                <>
                  <Sparkles className="size-4 mr-2" />
                  Derive Asset ID
                </>
              )}
            </Button>
          </div>
        )}

        {/* Step 2: Sign & Issue */}
        {step === "mint" && derivedAssetId && (
          <div className="rounded-xl border border-border bg-surface p-6 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Sparkles className="size-5 text-purple-400" />
                <h2 className="font-medium text-fg">Issue &amp; Mint RWA Asset</h2>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setStep("derive")}>
                Edit ID
              </Button>
            </div>

            <div className="rounded-lg border border-purple-500/30 bg-purple-500/10 p-4">
              <div className="flex items-center gap-2">
                <Gem className="size-4 text-purple-400" />
                <div className="min-w-0">
                  <p className="font-mono text-sm text-purple-400 truncate">
                    Asset ID: {derivedAssetId.slice(0, 20)}…
                  </p>
                  <p className="text-[10px] text-subtle">
                    Class: {assetClass} · ID: {uniqueId} · v{version}
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-xs text-muted block mb-1">Initial Supply (units)</label>
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="100"
                  inputMode="numeric"
                  className="w-full h-11 rounded-md border border-border bg-bg px-3 font-mono text-sm text-fg outline-none"
                />
              </div>

              <div>
                <label className="text-xs text-muted block mb-1">Max Supply (0 = uncapped)</label>
                <input
                  value={maxSupply}
                  onChange={(e) => setMaxSupply(e.target.value)}
                  placeholder="0"
                  inputMode="numeric"
                  className="w-full h-11 rounded-md border border-border bg-bg px-3 font-mono text-sm text-fg outline-none"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="text-xs text-muted block mb-1">Recipient Address</label>
                <input
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  placeholder="kvnc…dag or 64-hex"
                  className="w-full h-11 rounded-md border border-border bg-bg px-3 font-mono text-sm text-fg outline-none"
                />
              </div>

              <div>
                <label className="text-xs text-muted block mb-1">Legal URI (optional)</label>
                <input
                  value={legalUri}
                  onChange={(e) => setLegalUri(e.target.value)}
                  placeholder="https://… or ipfs://…"
                  className="w-full h-11 rounded-md border border-border bg-bg px-3 font-mono text-sm text-fg outline-none"
                />
              </div>

              <div>
                <label className="text-xs text-muted block mb-1">Custody URI (optional)</label>
                <input
                  value={custodyUri}
                  onChange={(e) => setCustodyUri(e.target.value)}
                  placeholder="https://… or ipfs://…"
                  className="w-full h-11 rounded-md border border-border bg-bg px-3 font-mono text-sm text-fg outline-none"
                />
              </div>
            </div>

            {/* Flexible Metadata URI + Optional IPFS Upload + Inline Hash Fallback */}
            <div className="space-y-3 rounded-lg border border-border bg-bg/60 p-4">
              <div>
                <label className="text-xs text-muted block mb-1 flex items-center gap-1.5">
                  <Upload className="size-3.5 text-muted" />
                  Metadata URI (https:// or ipfs:// — leave blank for inline JSON hash fallback)
                </label>
                <input
                  value={metadataUriInput}
                  onChange={(e) => setMetadataUriInput(e.target.value)}
                  placeholder="https://… or ipfs://bafy… (optional)"
                  className="w-full h-10 rounded-md border border-border bg-bg px-3 font-mono text-sm text-fg outline-none"
                />
                <p className="mt-1 text-[10px] text-subtle">
                  If left blank or if public IPFS pinning is rate-limited, we automatically hash the
                  canonical KVP-106 JSON locally and store <code className="text-fg">inline:sha256:…</code>{" "}
                  on-chain.
                </p>
              </div>

              <IpfsMetadataUpload
                metadata={createRwaMetadata({
                  name: assetName.trim() || `RWA ${assetClass} ${uniqueId}`,
                  description: `RWA asset: ${assetClass} - ${uniqueId}`,
                  image: metadataUriInput.trim() || "https://kovanica.online/icon-192.png",
                  asset_class: assetClass,
                  legal_uri: legalUri.trim(),
                  custody_uri: custodyUri.trim(),
                  total_supply: amount || "100",
                  jurisdiction: jurisdiction.trim() || "RS",
                  external_url: "",
                  attributes: [],
                })}
                onSuccess={(cid) => {
                  setMetadataCid(cid);
                  setMetadataUriInput(`ipfs://${cid}`);
                  toast.success("Metadata uploaded to IPFS");
                }}
                onError={() => {
                  toast.info(
                    "Public IPFS upload unavailable — you can still issue with a direct URL or inline JSON hash fallback.",
                  );
                }}
              />
            </div>

            <div className="rounded-lg border border-border bg-bg p-3 text-xs text-muted space-y-1">
              <div className="flex justify-between">
                <span>RWA Registration (<code className="text-fg">rwa_create</code>)</span>
                <span className="font-mono text-fg">
                  {FIXED_FEES.rwa_create / ATOM} {TOKEN}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Contract Deploy (<code className="text-fg">Deploy</code>)</span>
                <span className="font-mono text-fg">
                  {FIXED_FEES.deploy / ATOM} {TOKEN}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Subsequent Mint (<code className="text-fg">rwa_mint</code>)</span>
                <span className="font-mono text-fg">
                  {FIXED_FEES.rwa_mint / ATOM} {TOKEN}
                </span>
              </div>
              <p className="pt-1 text-[10px] text-subtle">
                Fee split: 75% burned, 25% to block miner. Signed client-side and broadcast via{" "}
                <code className="text-fg">kovanica_sendRawTransaction</code>.
              </p>
            </div>

            {mintStatus && (
              <div className="flex items-center gap-2 rounded-lg border border-blue/30 bg-blue/10 px-3.5 py-2.5 text-xs text-blue">
                <Loader2 className="size-4 shrink-0 animate-spin" />
                <span>{mintStatus}</span>
              </div>
            )}

            <Button
              onClick={() => void handleIssueAndMint()}
              disabled={minting || !to || !amount || !activeSigner}
              className="w-full h-12"
            >
              {minting ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  Signing &amp; Broadcasting RWA…
                </>
              ) : (
                <>
                  <Sparkles className="size-4 mr-2" />
                  Sign &amp; Issue RWA on Testnet
                </>
              )}
            </Button>
          </div>
        )}

        {/* Step 3: Success */}
        {step === "success" && issuedResult && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-6 space-y-4">
            <div className="text-center space-y-2">
              <div className="mx-auto w-14 h-14 rounded-full bg-emerald-500/15 flex items-center justify-center">
                <CheckCircle2 className="size-7 text-emerald-400" />
              </div>
              <h2 className="font-display text-xl text-fg">RWA Asset Issued on Testnet!</h2>
            </div>

            <div className="space-y-1.5 rounded-lg border border-border bg-bg/80 p-3.5 font-mono text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted">RWA Contract</span>
                <span className="truncate text-fg">{issuedResult.contractKvnc}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted">Asset ID</span>
                <span className="truncate text-fg">{shortId(issuedResult.assetIdHex)}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted">Deploy Tx</span>
                <span className="truncate text-fg">{shortId(issuedResult.deployTxHash)}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted">Register Tx</span>
                <span className="truncate text-fg">{shortId(issuedResult.createTxHash)}</span>
              </div>
              {issuedResult.mintTxHash && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted">Mint Tx</span>
                  <span className="truncate text-fg">{shortId(issuedResult.mintTxHash)}</span>
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2 justify-center">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(issuedResult.contractKvnc)
                    .then(() => toast.success("Contract address copied"))
                }
              >
                <Copy className="size-3.5 mr-1.5" />
                Copy Contract
              </Button>
              <Button variant="outline" size="sm" onClick={() => setStep("derive")}>
                Issue Another
              </Button>
              <Button asChild size="sm">
                <Link to="/explorer">
                  <ExternalLink className="size-3.5 mr-1.5" />
                  Open in Explorer
                </Link>
              </Button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
