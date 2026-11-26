import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Puzzle,
  Radio,
  RefreshCw,
  Scan,
  Send,
  ShieldCheck,
  Sparkles,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { fmtKvnc, parseKvnc } from "@/lib/ledger/format";
import { shortId } from "@/lib/ledger/hash";
import { useLedger } from "@/lib/ledger/store";
import {
  deriveOnetimeAddress,
  deriveOnetimeSpendKey,
  deriveStealthKeypairFromMnemonic,
  fetchStealthAnnouncements,
  generateStealthKeypair,
  importStealthMetaFromExtension,
  prepareStealthSpend,
  publishStealthAnnouncement,
  scanStealthOutputs,
  signSighashWithStealthScalar,
  submitStealthSpend,
  type StealthAnnouncement,
  type StealthKeypair,
  type StealthMetaAddress,
  type StealthOnetime,
  type StealthScanHit,
} from "@/lib/protocol/stealth";
import { parseAddr } from "@/lib/wallet/address";
import { webWalletSigner } from "@/lib/wallet/tx-builder";

type Tab = "receive" | "send" | "scan" | "spend";

/**
 * KVP-103 / RFC-003 — Client-Side Dual-Key Stealth Addresses on Ed25519.
 *
 * Every one-time address is a standard Kovanica L1 account (`kvnc…dag`).
 * Scan and spend private keys never leave the browser.
 */
export function StealthView() {
  const wallet = useLedger((s) => s.wallet);
  const unlockedWallet = useMemo(() => webWalletSigner(wallet), [wallet]);

  const [tab, setTab] = useState<Tab>("receive");

  // Receive tab state
  const [keys, setKeys] = useState<StealthKeypair | null>(null);
  const [importedMeta, setImportedMeta] = useState<StealthMetaAddress | null>(null);
  const [importingExt, setImportingExt] = useState(false);
  const [extStatus, setExtStatus] = useState<{ kind: "success" | "error"; message: string } | null>(
    null,
  );
  const [showSecrets, setShowSecrets] = useState(false);

  // Send / Derive tab state
  const [targetMeta, setTargetMeta] = useState("");
  const [derived, setDerived] = useState<StealthOnetime | null>(null);
  const [txHint, setTxHint] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);

  // Scan tab state
  const [scanPriv, setScanPriv] = useState("");
  const [scanSpendPub, setScanSpendPub] = useState("");
  const [viewTagFilter, setViewTagFilter] = useState("");
  const [manualEphemeral, setManualEphemeral] = useState("");
  const [scanning, setScanning] = useState(false);
  const [hits, setHits] = useState<StealthScanHit[] | null>(null);
  const [feedAnnouncements, setFeedAnnouncements] = useState<StealthAnnouncement[]>([]);
  const [loadingFeed, setLoadingFeed] = useState(false);

  const loadAnnouncementsFeed = useCallback(async (tag?: string) => {
    setLoadingFeed(true);
    try {
      const rows = await fetchStealthAnnouncements(tag);
      setFeedAnnouncements(rows);
      return rows;
    } catch {
      return [];
    } finally {
      setLoadingFeed(false);
    }
  }, []);

  // Pre-fill Scan tab when arriving from an Explorer Stealth (KVP-103) badge link
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const qTab = params.get("tab");
    const qTag = params.get("view_tag")?.trim() ?? "";
    const qEph = params.get("ephemeral")?.trim() ?? "";
    if (qTab === "receive" || qTab === "send" || qTab === "scan" || qTab === "spend") {
      setTab(qTab);
    } else if (qTag || qEph) {
      setTab("scan");
    }
    if (qTag) setViewTagFilter(qTag);
    if (qEph) setManualEphemeral(qEph);
  }, []);

  useEffect(() => {
    void loadAnnouncementsFeed();
  }, [loadAnnouncementsFeed]);

  // Spend tab state
  const [spendEphemeral, setSpendEphemeral] = useState("");
  const [spendScanPriv, setSpendScanPriv] = useState("");
  const [spendPriv, setSpendPriv] = useState("");
  const [spendTo, setSpendTo] = useState("");
  const [spendAmount, setSpendAmount] = useState("1");
  const [spending, setSpending] = useState(false);
  const [lastSpendTx, setLastSpendTx] = useState<{ txHash: string; from: string; fee: number } | null>(
    null,
  );

  function copyText(text: string, label: string) {
    void navigator.clipboard.writeText(text).then(
      () => toast.success(`${label} copied`),
      () => toast.error("Clipboard copy failed"),
    );
  }

  function onGenerateRandom() {
    try {
      const kp = generateStealthKeypair();
      setKeys(kp);
      setImportedMeta(null);
      setExtStatus(null);
      setShowSecrets(false);
      toast.success("Generated fresh KVP-103 dual-key stealth identity locally");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Key generation failed");
    }
  }

  function onDeriveFromWallet() {
    if (!unlockedWallet || unlockedWallet.kind !== "web-wallet") {
      toast.error("Unlock your Web Wallet on /wallet first");
      return;
    }
    try {
      const kp = deriveStealthKeypairFromMnemonic(unlockedWallet.mnemonic);
      setKeys(kp);
      setImportedMeta(null);
      setExtStatus(null);
      setShowSecrets(false);
      toast.success("Derived deterministic stealth identity from your Web Wallet phrase");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Derivation failed");
    }
  }

  async function onImportFromExtension() {
    setImportingExt(true);
    setExtStatus(null);
    try {
      const meta = await importStealthMetaFromExtension();
      setImportedMeta(meta);
      setKeys(null);
      setShowSecrets(false);
      setScanSpendPub(meta.spendPubkeyHex);
      setExtStatus({
        kind: "success",
        message:
          "Imported public stealth meta-address and scan/spend pubkeys from Kovanica Extension. Private keys remain inside the extension.",
      });
      toast.success("Imported stealth meta-address from Kovanica Extension");
    } catch (e) {
      const message =
        e instanceof Error
          ? e.message
          : "Failed to import stealth meta-address from Kovanica Extension. Ensure the extension is installed and unlocked.";
      setExtStatus({ kind: "error", message });
      toast.error(message);
    } finally {
      setImportingExt(false);
    }
  }

  function onUseMyKeysInScan() {
    if (!keys) return;
    setScanPriv(keys.scanPrivkeyHex);
    setScanSpendPub(keys.spendPubkeyHex);
    setTab("scan");
    toast.success("Loaded scan key + spend pubkey into Scan (browser memory only)");
  }

  function onDeriveOnetime() {
    if (!targetMeta.trim()) {
      toast.error("Paste a recipient stealth meta-address (st:kvnc:…)");
      return;
    }
    try {
      const res = deriveOnetimeAddress(targetMeta.trim());
      setDerived(res);
      setPublished(false);
      toast.success("Derived unlinkable one-time L1 address client-side");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Derivation failed");
    }
  }

  async function onPublishAnnouncement() {
    if (!derived) return;
    setPublishing(true);
    try {
      await publishStealthAnnouncement({
        ephemeralPubkeyHex: derived.ephemeralPubkeyHex,
        viewTag: derived.viewTag,
        stealthAddress: derived.address,
        txHash: txHint.trim() || undefined,
      });
      setPublished(true);
      toast.success("Published public stealth announcement (no secrets sent)");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Publish failed");
    } finally {
      setPublishing(false);
    }
  }

  async function onScan() {
    let effectiveScanPriv = scanPriv.trim();
    let effectiveSpendPub = scanSpendPub.trim();

    // 1-click convenience: if scan keys are empty and Web Wallet is unlocked, derive them locally
    if ((!effectiveScanPriv || !effectiveSpendPub) && unlockedWallet?.kind === "web-wallet") {
      try {
        const derivedKeys = keys ?? deriveStealthKeypairFromMnemonic(unlockedWallet.mnemonic);
        if (!keys) setKeys(derivedKeys);
        effectiveScanPriv = derivedKeys.scanPrivkeyHex;
        effectiveSpendPub = derivedKeys.spendPubkeyHex;
        setScanPriv(effectiveScanPriv);
        setScanSpendPub(effectiveSpendPub);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to derive wallet stealth keys");
        return;
      }
    }

    if (!effectiveScanPriv || !effectiveSpendPub) {
      toast.error("Scan private key and spend public key are required (or unlock Web Wallet)");
      return;
    }
    setScanning(true);
    try {
      const latestFeed = await loadAnnouncementsFeed(viewTagFilter.trim() || undefined);
      const manual = manualEphemeral
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await scanStealthOutputs({
        scanPrivkeyHex: effectiveScanPriv,
        spendPubkeyHex: effectiveSpendPub,
        viewTagFilter: viewTagFilter.trim() || undefined,
        manualEphemerals: manual,
      });
      setHits(res);
      toast.success(
        res.length
          ? `Scanned ${latestFeed.length} announcement${latestFeed.length === 1 ? "" : "s"} — found ${res.length} match${res.length === 1 ? "" : "es"}`
          : `Scanned ${latestFeed.length} announcement${latestFeed.length === 1 ? "" : "s"} — no matches found`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  }

  function onLoadHitIntoSpend(hit: StealthScanHit) {
    setSpendEphemeral(hit.ephemeralPubkeyHex);
    if (scanPriv.trim()) setSpendScanPriv(scanPriv.trim());
    if (keys?.spendPrivkeyHex) setSpendPriv(keys.spendPrivkeyHex);
    setTab("spend");
    toast.success(`Loaded ${shortId(hit.address)} into Spend`);
  }

  async function onSpend() {
    const atoms = parseKvnc(spendAmount);
    if (atoms === null || atoms <= 0) {
      toast.error("Enter a positive KVNC amount");
      return;
    }
    if (!parseAddr(spendTo.trim())) {
      toast.error("Enter a valid destination address (kvnc…dag or 64-hex)");
      return;
    }
    if (!spendEphemeral.trim() || !spendScanPriv.trim() || !spendPriv.trim()) {
      toast.error("Ephemeral pubkey, scan private key, and spend private key are required");
      return;
    }

    setSpending(true);
    setLastSpendTx(null);
    try {
      const derivedKey = deriveOnetimeSpendKey({
        scanPrivkeyHex: spendScanPriv.trim(),
        spendPrivkeyHex: spendPriv.trim(),
        ephemeralPubkeyHex: spendEphemeral.trim(),
      });

      const prep = await prepareStealthSpend(derivedKey.address, spendTo.trim(), atoms);
      const { signatureHex } = signSighashWithStealthScalar(
        derivedKey.oneTimeScalarHex,
        prep.sighash,
      );
      const sub = await submitStealthSpend(
        derivedKey.address,
        spendTo.trim(),
        atoms,
        signatureHex,
      );
      setLastSpendTx({ txHash: sub.tx, from: derivedKey.address, fee: prep.fee });
      toast.success(`Stealth spend broadcast! ${shortId(sub.tx)}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Stealth spend failed");
    } finally {
      setSpending(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-12 pt-8 md:px-8">
      <p className="font-mono text-[11px] tracking-brand text-blue uppercase">
        KVP-103 · RFC-003 · Ed25519 ECDH
      </p>
      <h1 className="mt-1 font-display text-3xl tracking-tight text-fg italic md:text-4xl">
        Stealth Addresses
      </h1>
      <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted">
        Unlinkable one-time L1 accounts (<code className="text-fg">kvnc…dag</code>) using
        dual-key Ed25519 ECDH. Scan and spend private keys never leave your browser; spends sign
        standard L1 transactions directly on Testnet (Chain 2).
      </p>

      <div className="mt-7 inline-flex flex-wrap rounded-md bg-surface-2 p-0.5">
        {(
          [
            { id: "receive" as const, label: "Receive", icon: KeyRound },
            { id: "send" as const, label: "Derive & Announce", icon: Send },
            { id: "scan" as const, label: "Scan", icon: Scan },
            { id: "spend" as const, label: "Spend", icon: ShieldCheck },
          ] as const
        ).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={
              tab === id
                ? "inline-flex h-9 items-center gap-1.5 rounded-sm bg-bg px-3 text-sm font-medium text-fg"
                : "inline-flex h-9 items-center gap-1.5 rounded-sm px-3 text-sm font-medium text-muted hover:text-fg"
            }
          >
            <Icon className="size-3.5" />
            {label}
          </button>
        ))}
      </div>

      <div className="mt-6 space-y-5 rounded-xl border border-border bg-surface p-5">
        {tab === "receive" && (
          <div className="space-y-4">
            <p className="text-xs leading-relaxed text-muted">
              Share your public <strong className="text-fg">Stealth Meta-Address</strong> so
              senders can derive fresh, unlinkable one-time <code className="text-fg">kvnc…dag</code>{" "}
              addresses for every payment.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={onGenerateRandom}>
                <Sparkles className="mr-1.5 size-4" />
                Generate Stealth Keys
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={importingExt}
                onClick={() => void onImportFromExtension()}
              >
                {importingExt ? (
                  <Loader2 className="mr-1.5 size-4 animate-spin" />
                ) : (
                  <Puzzle className="mr-1.5 size-4" />
                )}
                Import from Kovanica Extension
              </Button>
              {unlockedWallet ? (
                <Button type="button" variant="outline" onClick={onDeriveFromWallet}>
                  <Wallet className="mr-1.5 size-4" />
                  Derive from Unlocked Wallet
                </Button>
              ) : (
                <Button asChild variant="outline">
                  <Link to="/wallet">
                    <Wallet className="mr-1.5 size-4" />
                    Unlock Wallet to Derive
                  </Link>
                </Button>
              )}
            </div>

            {extStatus && (
              <p
                role={extStatus.kind === "error" ? "alert" : "status"}
                className={
                  extStatus.kind === "error"
                    ? "rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300"
                    : "rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300"
                }
              >
                {extStatus.message}
              </p>
            )}

            {importedMeta && !keys && (
              <div className="space-y-3 rounded-xl border border-gold/30 bg-gold/5 p-4">
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-medium tracking-wide text-gold uppercase">
                      Extension Stealth Meta-Address (Safe to Share)
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      onClick={() => copyText(importedMeta.metaAddress, "Stealth meta-address")}
                    >
                      <Copy className="mr-1 size-3" /> Copy
                    </Button>
                  </div>
                  <p className="mt-1 break-all rounded-md border border-border bg-bg p-2.5 font-mono text-xs text-fg">
                    {importedMeta.metaAddress}
                  </p>
                </div>

                <div className="grid gap-2 text-xs">
                  <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-bg px-3 py-2">
                    <span className="text-muted">Scan Pubkey (V)</span>
                    <div className="flex items-center gap-1.5">
                      <code className="font-mono text-fg">
                        {shortId(importedMeta.scanPubkeyHex, 10)}
                      </code>
                      <button
                        type="button"
                        onClick={() => copyText(importedMeta.scanPubkeyHex, "Scan public key")}
                        className="text-subtle hover:text-fg"
                        aria-label="Copy scan public key"
                      >
                        <Copy className="size-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-bg px-3 py-2">
                    <span className="text-muted">Spend Pubkey (B)</span>
                    <div className="flex items-center gap-1.5">
                      <code className="font-mono text-fg">
                        {shortId(importedMeta.spendPubkeyHex, 10)}
                      </code>
                      <button
                        type="button"
                        onClick={() => copyText(importedMeta.spendPubkeyHex, "Spend public key")}
                        className="text-subtle hover:text-fg"
                        aria-label="Copy spend public key"
                      >
                        <Copy className="size-3.5" />
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setScanSpendPub(importedMeta.spendPubkeyHex);
                      setTab("scan");
                      toast.success("Loaded extension spend pubkey into Scan");
                    }}
                  >
                    <Scan className="mr-1.5 size-3.5" />
                    Load Spend Pubkey into Scan
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setTargetMeta(importedMeta.metaAddress);
                      setTab("send");
                    }}
                  >
                    <Send className="mr-1.5 size-3.5" />
                    Test Derive Address
                  </Button>
                </div>
              </div>
            )}

            {keys && (
              <div className="space-y-3 rounded-xl border border-gold/30 bg-gold/5 p-4">
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-medium tracking-wide text-gold uppercase">
                      Public Stealth Meta-Address (Safe to Share)
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      onClick={() => copyText(keys.metaAddress, "Stealth meta-address")}
                    >
                      <Copy className="mr-1 size-3" /> Copy
                    </Button>
                  </div>
                  <p className="mt-1 break-all rounded-md border border-border bg-bg p-2.5 font-mono text-xs text-fg">
                    {keys.metaAddress}
                  </p>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <span className="text-[11px] font-medium tracking-wide text-subtle uppercase">
                    Private Keys (Local Only — Back Up Offline)
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    onClick={() => setShowSecrets((v) => !v)}
                  >
                    {showSecrets ? (
                      <>
                        <EyeOff className="mr-1 size-3" /> Hide
                      </>
                    ) : (
                      <>
                        <Eye className="mr-1 size-3" /> Reveal
                      </>
                    )}
                  </Button>
                </div>

                <div className="grid gap-2 text-xs">
                  <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-bg px-3 py-2">
                    <span className="text-muted">Scan Privkey (watch-only)</span>
                    <div className="flex items-center gap-1.5">
                      <code className="font-mono text-fg">
                        {showSecrets ? `${keys.scanPrivkeyHex.slice(0, 20)}…` : "••••••••••••••••"}
                      </code>
                      <button
                        type="button"
                        onClick={() => copyText(keys.scanPrivkeyHex, "Scan private key")}
                        className="text-subtle hover:text-fg"
                        aria-label="Copy scan private key"
                      >
                        <Copy className="size-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-bg px-3 py-2">
                    <span className="text-muted">Spend Privkey (required to spend)</span>
                    <div className="flex items-center gap-1.5">
                      <code className="font-mono text-fg">
                        {showSecrets ? `${keys.spendPrivkeyHex.slice(0, 20)}…` : "••••••••••••••••"}
                      </code>
                      <button
                        type="button"
                        onClick={() => copyText(keys.spendPrivkeyHex, "Spend private key")}
                        className="text-subtle hover:text-fg"
                        aria-label="Copy spend private key"
                      >
                        <Copy className="size-3.5" />
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  <Button type="button" size="sm" variant="outline" onClick={onUseMyKeysInScan}>
                    <Scan className="mr-1.5 size-3.5" />
                    Load into Scan
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setTargetMeta(keys.metaAddress);
                      setTab("send");
                    }}
                  >
                    <Send className="mr-1.5 size-3.5" />
                    Test Derive Address
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "send" && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium tracking-wide text-subtle uppercase">
                Recipient Stealth Meta-Address
              </label>
              <input
                className="mt-1.5 w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-xs text-fg placeholder:text-subtle focus:outline-none focus:ring-1 focus:ring-blue"
                placeholder="st:kvnc:<64-hex-scan-pub>:<64-hex-spend-pub>"
                value={targetMeta}
                onChange={(e) => setTargetMeta(e.target.value)}
              />
            </div>

            <Button type="button" onClick={onDeriveOnetime}>
              <KeyRound className="mr-1.5 size-4" />
              Derive One-Time L1 Address
            </Button>

            {derived && (
              <div className="space-y-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-emerald-400">
                    One-Time Stealth Address (Standard L1 Account)
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    onClick={() => copyText(derived.address, "One-time address")}
                  >
                    <Copy className="mr-1 size-3" /> Copy
                  </Button>
                </div>
                <p className="break-all rounded-md border border-border bg-bg p-2.5 font-mono text-fg">
                  {derived.address}
                </p>

                <div className="space-y-1 font-mono text-[11px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted">Ephemeral Pubkey (R)</span>
                    <button
                      type="button"
                      onClick={() => copyText(derived.ephemeralPubkeyHex, "Ephemeral pubkey")}
                      className="truncate text-fg hover:underline"
                    >
                      {shortId(derived.ephemeralPubkeyHex)}
                    </button>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted">View Tag (2-byte filter)</span>
                    <span className="text-gold">0x{derived.viewTag}</span>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] text-muted">
                    Optional Funding Tx Hash (for announcement metadata)
                  </label>
                  <input
                    className="mt-1 w-full rounded-md border border-border bg-bg px-2.5 py-1.5 font-mono text-xs text-fg"
                    placeholder="0x… (optional)"
                    value={txHint}
                    onChange={(e) => setTxHint(e.target.value)}
                  />
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    type="button"
                    size="sm"
                    disabled={publishing || published}
                    onClick={() => void onPublishAnnouncement()}
                  >
                    {publishing ? (
                      <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                    ) : (
                      <Radio className="mr-1.5 size-3.5" />
                    )}
                    {published ? "Announcement Published" : "Publish Announcement"}
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <Link to="/wallet">
                      <Wallet className="mr-1.5 size-3.5" />
                      Fund in Wallet
                    </Link>
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "scan" && (
          <div className="space-y-4">
            <p className="text-xs leading-relaxed text-muted">
              True watch-only ECDH scanning: runs <strong className="text-fg">100% locally</strong>{" "}
              using only your Scan Private Key + Spend Public Key. Private keys are never uploaded.
            </p>
            <div>
              <label className="block text-xs font-medium tracking-wide text-subtle uppercase">
                Scan Private Key (64 hex — local only)
              </label>
              <input
                type="password"
                className="mt-1.5 w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-xs text-fg"
                placeholder="64-char hex scan private key"
                value={scanPriv}
                onChange={(e) => setScanPriv(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium tracking-wide text-subtle uppercase">
                Spend Public Key (64 hex)
              </label>
              <input
                className="mt-1.5 w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-xs text-fg"
                placeholder="64-char hex spend public key"
                value={scanSpendPub}
                onChange={(e) => setScanSpendPub(e.target.value)}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium tracking-wide text-subtle uppercase">
                  View Tag Filter (optional, 4 hex)
                </label>
                <input
                  className="mt-1.5 w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-xs text-fg"
                  placeholder="e.g. a1b2"
                  value={viewTagFilter}
                  onChange={(e) => setViewTagFilter(e.target.value)}
                  maxLength={6}
                />
              </div>
              <div>
                <label className="block text-xs font-medium tracking-wide text-subtle uppercase">
                  Manual Ephemeral Pubkey (optional)
                </label>
                <input
                  className="mt-1.5 w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-xs text-fg"
                  placeholder="64-hex R (for offline scan)"
                  value={manualEphemeral}
                  onChange={(e) => setManualEphemeral(e.target.value)}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" disabled={scanning} onClick={() => void onScan()}>
                {scanning ? (
                  <>
                    <Loader2 className="mr-1.5 size-4 animate-spin" />
                    Loading &amp; Scanning Locally…
                  </>
                ) : (
                  <>
                    <Scan className="mr-1.5 size-4" />
                    Load &amp; Scan On-Chain Announcements
                  </>
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={loadingFeed}
                onClick={() => void loadAnnouncementsFeed(viewTagFilter.trim() || undefined)}
              >
                <RefreshCw className={loadingFeed ? "mr-1.5 size-3.5 animate-spin" : "mr-1.5 size-3.5"} />
                Refresh Feed ({feedAnnouncements.length})
              </Button>
            </div>

            {/* Live Public Announcement Feed Strip */}
            <div className="rounded-lg border border-border/80 bg-bg/70 p-3 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[10px] uppercase tracking-wider text-subtle">
                  Public KVP-103 Announcement Feed ({feedAnnouncements.length} loaded)
                </span>
                <span className="font-mono text-[10px] text-muted">/api/stealth/announcements</span>
              </div>
              {feedAnnouncements.length === 0 ? (
                <p className="mt-1.5 text-[11px] text-muted">
                  No public stealth announcements published yet. Publish one from Derive &amp; Announce or paste an ephemeral pubkey above.
                </p>
              ) : (
                <ul className="mt-2 max-h-40 space-y-1.5 overflow-y-auto font-mono text-[11px]">
                  {feedAnnouncements.slice(0, 8).map((ann) => (
                    <li
                      key={`${ann.ephemeralPubkeyHex}-${ann.stealthAddressHex}`}
                      className="flex flex-wrap items-center justify-between gap-2 rounded border border-border/50 bg-surface/50 px-2.5 py-1.5"
                    >
                      <span className="flex items-center gap-1.5 text-fg">
                        <span className="rounded bg-purple-500/15 px-1.5 py-0.5 text-[10px] text-purple-300">
                          0x{ann.viewTag}
                        </span>
                        <span>R={shortId(ann.ephemeralPubkeyHex, 6)}</span>
                      </span>
                      <span className="text-muted">→ {shortId(ann.stealthAddress)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {hits !== null && (
              <div className="space-y-2 pt-1">
                {hits.length === 0 ? (
                  <p className="rounded-lg border border-border bg-bg p-3 text-xs text-muted">
                    No matching stealth outputs found in published announcements.
                  </p>
                ) : (
                  hits.map((hit) => (
                    <div
                      key={hit.addressHex}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-bg p-3 text-xs"
                    >
                      <div className="min-w-0 space-y-0.5">
                        <p className="truncate font-mono text-fg">{shortId(hit.address)}</p>
                        <p className="font-mono text-[11px] text-muted">
                          Balance: <strong className="text-emerald-400">{fmtKvnc(hit.balanceAtoms)} KVNC</strong> ·{" "}
                          {hit.utxoCount} UTXO{hit.utxoCount === 1 ? "" : "s"} · tag 0x{hit.viewTag}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => onLoadHitIntoSpend(hit)}
                      >
                        Spend
                      </Button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        {tab === "spend" && (
          <div className="space-y-4">
            <p className="text-xs leading-relaxed text-muted">
              Derives the one-time Ed25519 spend scalar{" "}
              <code className="text-fg">p = (b + t) mod L</code> locally in your browser, signs a
              standard L1 transfer sighash, and broadcasts via{" "}
              <code className="text-fg">/api/submit</code>.
            </p>
            <div>
              <label className="block text-xs font-medium tracking-wide text-subtle uppercase">
                Ephemeral Pubkey (R, 64 hex)
              </label>
              <input
                className="mt-1.5 w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-xs text-fg"
                placeholder="64-hex ephemeral pubkey from announcement"
                value={spendEphemeral}
                onChange={(e) => setSpendEphemeral(e.target.value)}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium tracking-wide text-subtle uppercase">
                  Scan Private Key (64 hex)
                </label>
                <input
                  type="password"
                  className="mt-1.5 w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-xs text-fg"
                  placeholder="Local only"
                  value={spendScanPriv}
                  onChange={(e) => setSpendScanPriv(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium tracking-wide text-subtle uppercase">
                  Spend Private Key (64 hex)
                </label>
                <input
                  type="password"
                  className="mt-1.5 w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-xs text-fg"
                  placeholder="Local only"
                  value={spendPriv}
                  onChange={(e) => setSpendPriv(e.target.value)}
                />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium tracking-wide text-subtle uppercase">
                  Destination Address
                </label>
                <input
                  className="mt-1.5 w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-xs text-fg"
                  placeholder="kvnc…dag or 64-hex"
                  value={spendTo}
                  onChange={(e) => setSpendTo(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium tracking-wide text-subtle uppercase">
                  Amount (KVNC)
                </label>
                <input
                  className="mt-1.5 w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-xs text-fg"
                  value={spendAmount}
                  onChange={(e) => setSpendAmount(e.target.value)}
                  inputMode="decimal"
                />
              </div>
            </div>

            <Button
              type="button"
              className="h-11 w-full"
              disabled={spending}
              onClick={() => void onSpend()}
            >
              {spending ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Deriving One-Time Key &amp; Signing…
                </>
              ) : (
                <>
                  <ShieldCheck className="mr-2 size-4" />
                  Sign &amp; Broadcast Stealth Spend
                </>
              )}
            </Button>

            {lastSpendTx && (
              <div className="space-y-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs">
                <div className="flex items-center gap-2 font-medium text-emerald-400">
                  <CheckCircle2 className="size-4" />
                  <span>Stealth Spend Broadcast to Testnet!</span>
                </div>
                <div className="space-y-1 font-mono text-[11px]">
                  <div className="flex justify-between gap-2">
                    <span className="text-muted">One-Time Source</span>
                    <span className="truncate text-fg">{shortId(lastSpendTx.from)}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-muted">Tx Hash</span>
                    <span className="truncate text-fg">{shortId(lastSpendTx.txHash)}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-muted">Fee</span>
                    <span className="text-fg">{fmtKvnc(lastSpendTx.fee)} KVNC</span>
                  </div>
                </div>
                <Button asChild size="sm" className="w-full text-xs">
                  <Link to="/explorer">
                    <ExternalLink className="mr-1.5 size-3.5" />
                    View in Explorer
                  </Link>
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
