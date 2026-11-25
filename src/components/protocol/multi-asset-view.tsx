import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Coins,
  Layers,
  ArrowRightLeft,
  History,
  Copy,
  Gem,
  Landmark,
  Waves,
  PlusCircle,
  Loader2,
  CheckCircle2,
  ExternalLink,
  Eye,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  NATIVE_ASSET_ID,
  fetchAddressBalances,
  fetchAddressHistory,
  prepareTransfer,
  assetPickerOptions,
  shortAssetLabel,
  type AddressBalances,
  type AddressHistory,
  type PrepareResult,
  type AssetId,
} from "@/lib/protocol/multi-asset";
import { parseKvnc, fmtKvnc } from "@/lib/ledger/format";
import { ATOM } from "@/lib/ledger/types";
import { FIXED_FEES, TOKEN } from "@/lib/networkConstants";
import { useLedger } from "@/lib/ledger/store";
import { hexToKvnc } from "@/lib/wallet/address";
import { shortId } from "@/lib/ledger/hash";
import {
  connectExtensionSigner,
  deployAndCreateToken,
  getKovanicaExtension,
  watchTokenContract,
  webWalletSigner,
  type ActiveSigner,
  type CreateTokenResult,
} from "@/lib/wallet/tx-builder";

type Tab = "create" | "balances" | "transfer" | "history";

const MAX_U128 = (1n << 128n) - 1n;

/**
 * KVP-102 / RFC-002 — Native multi-asset tokens + end-to-end KVP-102 token creator.
 */
export function MultiAssetView() {
  const wallet = useLedger((s) => s.wallet);
  const [tab, setTab] = useState<Tab>("create");
  const [address, setAddress] = useState("");
  const [balances, setBalances] = useState<AddressBalances | null>(null);
  const [history, setHistory] = useState<AddressHistory | null>(null);
  const [selectedAsset, setSelectedAsset] = useState<AssetId>(NATIVE_ASSET_ID);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("1");
  const [prepared, setPrepared] = useState<PrepareResult | null>(null);
  const [busy, setBusy] = useState(false);

  // Create Token (KVP-102) state
  const [tokenName, setTokenName] = useState("");
  const [tokenSymbol, setTokenSymbol] = useState("");
  const [tokenDecimals, setTokenDecimals] = useState("9");
  const [tokenSupply, setTokenSupply] = useState("1000000");
  const [tokenIcon, setTokenIcon] = useState("");
  const [extSigner, setExtSigner] = useState<ActiveSigner | null>(null);
  const [creating, setCreating] = useState(false);
  const [createStatus, setCreateStatus] = useState<string | null>(null);
  const [createdToken, setCreatedToken] = useState<CreateTokenResult | null>(null);
  const [watched, setWatched] = useState(false);

  const unlockedSigner = useMemo(() => webWalletSigner(wallet), [wallet]);
  const activeSigner = unlockedSigner ?? extSigner;
  const hasExtension = useMemo(() => getKovanicaExtension() !== null, []);

  useEffect(() => {
    if (!address && activeSigner) {
      setAddress(activeSigner.addressKvnc);
    } else if (!address && wallet?.address) {
      setAddress(hexToKvnc(wallet.address));
    }
  }, [activeSigner, address, wallet?.address]);

  const picker = useMemo(() => (balances ? assetPickerOptions(balances.balances) : []), [balances]);

  async function onConnectExtension() {
    try {
      const signer = await connectExtensionSigner();
      setExtSigner(signer);
      setAddress(signer.addressKvnc);
      toast.success(`Connected ${shortId(signer.addressKvnc)}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Extension connection failed");
    }
  }

  async function onCreateToken() {
    if (!activeSigner) {
      toast.error("Unlock your Web Wallet on /wallet or connect window.kovanica first");
      return;
    }

    const name = tokenName.trim();
    const symbol = tokenSymbol.trim();
    const decimals = Number.parseInt(tokenDecimals.trim(), 10);
    const supplyRaw = tokenSupply.trim();
    const icon = tokenIcon.trim();

    if (!name || name.length > 64) {
      toast.error("Token name is required (1–64 characters)");
      return;
    }
    if (!symbol || symbol.length > 12 || /\s/.test(symbol)) {
      toast.error("Symbol is required (1–12 characters, no spaces)");
      return;
    }
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
      toast.error("Decimals must be an integer between 0 and 18");
      return;
    }
    if (!/^\d+$/.test(supplyRaw)) {
      toast.error("Initial supply must be a positive whole number of tokens");
      return;
    }
    const whole = BigInt(supplyRaw);
    if (whole <= 0n) {
      toast.error("Initial supply must be greater than zero");
      return;
    }
    const supplyAtoms = whole * 10n ** BigInt(decimals);
    if (supplyAtoms > MAX_U128) {
      toast.error("Initial supply exceeds maximum u128 token supply");
      return;
    }
    if (icon && !icon.startsWith("https://") && !icon.startsWith("data:image/")) {
      toast.error("Icon URI must start with https:// or data:image/");
      return;
    }
    if (new TextEncoder().encode(icon).length > 8 * 1024) {
      toast.error("Icon URI must be 8 KiB or smaller");
      return;
    }

    setCreating(true);
    setCreatedToken(null);
    setWatched(false);
    setCreateStatus("Preparing KVP-102 token deployment…");

    try {
      const result = await deployAndCreateToken(activeSigner, {
        name,
        symbol,
        decimals,
        initialSupplyAtoms: supplyAtoms,
        icon,
        onStatus: (msg) => setCreateStatus(msg),
      });
      setCreatedToken(result);
      setCreateStatus(null);
      toast.success(`Token ${symbol} created on Testnet!`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Token creation failed";
      setCreateStatus(null);
      toast.error(msg);
    } finally {
      setCreating(false);
    }
  }

  async function onLoadBalances() {
    if (!address.trim()) {
      toast.error("Enter an address");
      return;
    }
    setBusy(true);
    try {
      const res = await fetchAddressBalances(address.trim());
      setBalances(res);
      const opts = assetPickerOptions(res.balances);
      if (opts.length) setSelectedAsset(opts[0].assetId);
      toast.success(
        opts.length > 1
          ? `${opts.length} assets`
          : opts[0]
            ? shortAssetLabel(opts[0].assetId)
            : "No spendable UTXOs",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Load failed");
    } finally {
      setBusy(false);
    }
  }

  async function onLoadHistory() {
    if (!address.trim()) {
      toast.error("Enter an address");
      return;
    }
    setBusy(true);
    try {
      const res = await fetchAddressHistory(address.trim());
      setHistory(res);
      if (!balances)
        setBalances({
          address: res.address,
          balance: res.balance,
          balances: res.balances,
          utxos: [],
        });
      toast.success(`${res.txs.length} history entries`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "History failed");
    } finally {
      setBusy(false);
    }
  }

  async function onPrepare() {
    if (!address.trim() || !to.trim()) {
      toast.error("From and to required");
      return;
    }
    const atoms = parseKvnc(amount);
    if (atoms === null || atoms <= 0) {
      toast.error("Enter a positive amount");
      return;
    }
    setBusy(true);
    setPrepared(null);
    try {
      const res = await prepareTransfer({
        from: address.trim(),
        to: to.trim(),
        amount: atoms,
        assetId: selectedAsset,
      });
      setPrepared(res);
      toast.success(`Prepared · fee ${fmtKvnc(res.fee)} (${res.feeAssetId})`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Prepare failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-12 pt-8 md:px-8">
      <p className="font-mono text-[11px] tracking-brand text-blue uppercase">KVP-102 · RFC-002</p>
      <h1 className="mt-1 font-display text-3xl tracking-tight text-fg italic md:text-4xl">
        Multi-asset &amp; Tokens
      </h1>
      <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted">
        Deploy KVP-102 fungible tokens directly from your browser with client-side Ed25519 signing,
        or inspect and transfer multi-asset balances on Testnet (Chain 2).
      </p>

      {/* Token tools — Swap, Pools, RWA, NFT */}
      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          to="/swap"
          className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg"
        >
          <ArrowRightLeft className="size-3.5 text-emerald-400" />
          AMM Swap
        </Link>
        <Link
          to="/pools"
          className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg"
        >
          <Waves className="size-3.5 text-blue" />
          DEX Pools
        </Link>
        <Link
          to="/rwa"
          className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg"
        >
          <Landmark className="size-3.5 text-gold" />
          RWA Registry
        </Link>
        <Link
          to="/wallet/rwa-manage"
          className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg"
        >
          <Landmark className="size-3.5 text-purple-400" />
          RWA Compliance
        </Link>
        <Link
          to="/wallet/rwa-issue"
          className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg"
        >
          <Landmark className="size-3.5 text-gold" />
          Issue RWA
        </Link>
        <Link
          to="/nft"
          className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg"
        >
          <Gem className="size-3.5 text-purple-400" />
          NFT (KVP-106)
        </Link>
        <Link
          to="/pool"
          className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg"
        >
          <Waves className="size-3.5 text-blue" />
          Mining Pool
        </Link>
      </div>

      <div className="mt-8 inline-flex flex-wrap rounded-md bg-surface-2 p-0.5">
        {(
          [
            { id: "create" as const, label: "Create Token", icon: PlusCircle },
            { id: "balances" as const, label: "Balances", icon: Layers },
            { id: "transfer" as const, label: "Transfer", icon: ArrowRightLeft },
            { id: "history" as const, label: "History", icon: History },
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

      <div className="mt-6 rounded-xl border border-border bg-surface p-5">
        {tab === "create" && (
          <div className="space-y-5">
            {/* Signer status bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-bg px-3.5 py-2.5 text-xs">
              {activeSigner ? (
                <div className="flex items-center gap-2 min-w-0">
                  <span className="size-2 shrink-0 rounded-full bg-emerald-400" />
                  <span className="text-muted">
                    Signer ({activeSigner.kind === "web-wallet" ? "Web Wallet" : "window.kovanica"}
                    ):
                  </span>
                  <code className="truncate font-mono text-fg">
                    {shortId(activeSigner.addressKvnc)}
                  </code>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-muted">
                  <Wallet className="size-3.5 text-gold" />
                  <span>Unlock your Web Wallet or connect window.kovanica to sign &amp; deploy.</span>
                </div>
              )}
              <div className="flex items-center gap-2">
                {!activeSigner && hasExtension && (
                  <Button type="button" size="sm" variant="outline" onClick={() => void onConnectExtension()}>
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

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium tracking-wide text-subtle uppercase">
                  Token Name
                </label>
                <input
                  className="mt-1.5 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg placeholder:text-subtle focus:outline-none focus:ring-1 focus:ring-blue"
                  placeholder="e.g. Kovanica Gold"
                  value={tokenName}
                  onChange={(e) => setTokenName(e.target.value)}
                  maxLength={64}
                  disabled={creating}
                />
              </div>
              <div>
                <label className="block text-xs font-medium tracking-wide text-subtle uppercase">
                  Symbol
                </label>
                <input
                  className="mt-1.5 w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm text-fg placeholder:text-subtle focus:outline-none focus:ring-1 focus:ring-blue"
                  placeholder="e.g. KGOLD"
                  value={tokenSymbol}
                  onChange={(e) => setTokenSymbol(e.target.value.toUpperCase())}
                  maxLength={12}
                  disabled={creating}
                />
              </div>
              <div>
                <label className="block text-xs font-medium tracking-wide text-subtle uppercase">
                  Decimals (0–18)
                </label>
                <input
                  className="mt-1.5 w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm text-fg placeholder:text-subtle focus:outline-none focus:ring-1 focus:ring-blue"
                  value={tokenDecimals}
                  onChange={(e) => setTokenDecimals(e.target.value)}
                  inputMode="numeric"
                  disabled={creating}
                />
              </div>
              <div>
                <label className="block text-xs font-medium tracking-wide text-subtle uppercase">
                  Initial Supply (whole tokens)
                </label>
                <input
                  className="mt-1.5 w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm text-fg placeholder:text-subtle focus:outline-none focus:ring-1 focus:ring-blue"
                  placeholder="1000000"
                  value={tokenSupply}
                  onChange={(e) => setTokenSupply(e.target.value)}
                  inputMode="numeric"
                  disabled={creating}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium tracking-wide text-subtle uppercase">
                  Icon URI (optional)
                </label>
                <input
                  className="mt-1.5 w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm text-fg placeholder:text-subtle focus:outline-none focus:ring-1 focus:ring-blue"
                  placeholder="https://… or data:image/png;base64,…"
                  value={tokenIcon}
                  onChange={(e) => setTokenIcon(e.target.value)}
                  disabled={creating}
                />
              </div>
            </div>

            {/* Balanced fixed fee summary */}
            <div className="rounded-lg border border-border bg-bg p-3.5 text-xs text-muted space-y-1.5">
              <div className="flex justify-between">
                <span>
                  Token Creation (<code className="text-fg">token_create</code>)
                </span>
                <span className="font-mono text-fg">
                  {FIXED_FEES.token_create / ATOM} {TOKEN}
                </span>
              </div>
              <div className="flex justify-between">
                <span>
                  Contract Deploy (<code className="text-fg">kovanica-token.wasm</code>)
                </span>
                <span className="font-mono text-fg">
                  {FIXED_FEES.deploy / ATOM} {TOKEN}
                </span>
              </div>
              <p className="pt-1 text-[11px] text-subtle">
                Balanced-tier fixed fee schedule (75% burned, 25% block miner). Signs 2 client-side
                transactions: <code className="text-fg">Deploy</code> then{" "}
                <code className="text-fg">token_create</code> via{" "}
                <code className="text-fg">kovanica_sendRawTransaction</code>.
              </p>
            </div>

            {createStatus && (
              <div className="flex items-center gap-2 rounded-lg border border-blue/30 bg-blue/10 px-3.5 py-2.5 text-xs text-blue">
                <Loader2 className="size-4 shrink-0 animate-spin" />
                <span>{createStatus}</span>
              </div>
            )}

            <Button
              type="button"
              className="w-full h-11"
              disabled={creating || !activeSigner}
              onClick={() => void onCreateToken()}
            >
              {creating ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  Deploying &amp; Creating Token…
                </>
              ) : (
                <>
                  <Coins className="size-4 mr-2" />
                  Create KVP-102 Token
                </>
              )}
            </Button>

            {createdToken && (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 space-y-3">
                <div className="flex items-center gap-2 text-emerald-400">
                  <CheckCircle2 className="size-5" />
                  <h3 className="font-medium">Token Created on Testnet!</h3>
                </div>
                <div className="space-y-1.5 font-mono text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted">Contract</span>
                    <span className="truncate text-fg">{createdToken.contractKvnc}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted">Deploy Tx</span>
                    <span className="truncate text-fg">{shortId(createdToken.deployTxHash)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted">Create Call Tx</span>
                    <span className="truncate text-fg">{shortId(createdToken.createTxHash)}</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      watchTokenContract(createdToken.contractHex);
                      setWatched(true);
                      toast.success("Added token contract to local watchlist");
                    }}
                  >
                    <Eye className="size-3.5 mr-1.5" />
                    {watched ? "Watched" : "Watch token"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(createdToken.contractKvnc)
                        .then(() => toast.success("Contract address copied"))
                    }
                  >
                    <Copy className="size-3.5 mr-1.5" />
                    Copy address
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
        )}

        {tab !== "create" && (
          <div className="mb-4">
            <label className="block text-xs font-medium tracking-wide text-subtle uppercase">
              Address
            </label>
            <div className="mt-1.5 flex gap-2">
              <input
                className="w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm text-fg placeholder:text-subtle focus:outline-none focus:ring-1 focus:ring-blue"
                placeholder="Ed25519 pubkey / address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => void (tab === "history" ? onLoadHistory() : onLoadBalances())}
              >
                {busy ? "…" : "Load"}
              </Button>
            </div>
          </div>
        )}

        {tab === "balances" && (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              Prefer the <code className="text-fg">balances</code> map. Scalar{" "}
              <code className="text-fg">balance</code> remains the KVNC alias.
            </p>
            {balances && (
              <>
                <ul className="space-y-2">
                  {picker.length === 0 && (
                    <li className="rounded-lg border border-border bg-bg px-3 py-2 text-sm text-muted">
                      No spendable balances for this address.
                    </li>
                  )}
                  {picker.map((b) => (
                    <li
                      key={b.assetId}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border bg-bg px-3 py-2"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <Coins className="size-3.5 shrink-0 text-blue" />
                        <span className="font-mono text-sm text-fg">
                          {shortAssetLabel(b.assetId, 12)}
                        </span>
                        {b.assetId === NATIVE_ASSET_ID && (
                          <span className="rounded bg-blue/15 px-1.5 py-0.5 font-mono text-[10px] text-blue uppercase">
                            native
                          </span>
                        )}
                      </div>
                      <span className="shrink-0 font-mono text-sm text-fg">
                        {fmtKvnc(b.amountAtoms)}
                      </span>
                    </li>
                  ))}
                </ul>
                {balances.utxos.length > 0 && (
                  <div>
                    <p className="text-xs font-medium tracking-wide text-subtle uppercase">
                      UTXOs ({balances.utxos.length})
                    </p>
                    <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto font-mono text-[11px] text-muted">
                      {balances.utxos.map((u) => (
                        <li key={`${u.tx}:${u.index}`} className="truncate">
                          <span className="text-fg">{shortAssetLabel(u.assetId)}</span>{" "}
                          {fmtKvnc(u.value)} · {u.tx.slice(0, 12)}…:{u.index}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
            <p className="text-xs text-subtle">
              <code className="text-fg">GET /api/utxos?address=</code> · 1 unit ={" "}
              {ATOM.toLocaleString()} atoms
            </p>
          </div>
        )}

        {tab === "transfer" && (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              Prepare is asset-scoped. Fees always in KVNC. Omitted{" "}
              <code className="text-fg">asset_id</code> defaults to native on the node; we always
              send it explicitly.
            </p>
            <div>
              <label className="block text-xs font-medium tracking-wide text-subtle uppercase">
                Asset
              </label>
              <select
                className="mt-1.5 w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm text-fg focus:outline-none focus:ring-1 focus:ring-blue"
                value={selectedAsset}
                onChange={(e) => setSelectedAsset(e.target.value)}
              >
                {picker.length === 0 && (
                  <option value={NATIVE_ASSET_ID}>KVNC (load balances first)</option>
                )}
                {picker.map((b) => (
                  <option key={b.assetId} value={b.assetId}>
                    {shortAssetLabel(b.assetId, 16)} · {fmtKvnc(b.amountAtoms)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium tracking-wide text-subtle uppercase">
                To
              </label>
              <input
                className="mt-1.5 w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm text-fg placeholder:text-subtle focus:outline-none focus:ring-1 focus:ring-blue"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="Destination address"
              />
            </div>
            <div>
              <label className="block text-xs font-medium tracking-wide text-subtle uppercase">
                Amount (display units)
              </label>
              <input
                className="mt-1.5 w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm text-fg placeholder:text-subtle focus:outline-none focus:ring-1 focus:ring-blue"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
              />
            </div>
            <Button className="w-full sm:w-auto" disabled={busy} onClick={() => void onPrepare()}>
              {busy ? "Preparing…" : "Prepare transfer"}
            </Button>
            {prepared && (
              <div className="space-y-2 rounded-lg border border-gold/30 bg-gold/5 p-3 font-mono text-xs text-fg">
                <p>
                  Fee {fmtKvnc(prepared.fee)}{" "}
                  <span className="text-muted">({prepared.feeAssetId})</span>
                </p>
                <p className="text-muted">
                  Inputs {prepared.inputs.length} · Outputs {prepared.outputs.length}
                  {prepared.change ? ` · change ${fmtKvnc(prepared.change.value)}` : ""}
                </p>
                <p className="break-all text-muted">sighash {prepared.sighash.slice(0, 24)}…</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(prepared.sighash)
                      .then(() => toast.success("Sighash copied"))
                  }
                >
                  <Copy className="size-3.5" /> Copy sighash
                </Button>
              </div>
            )}
            <p className="text-xs text-subtle">
              <code className="text-fg">POST /api/prepare</code> with{" "}
              <code className="text-fg">asset_id</code>
            </p>
          </div>
        )}

        {tab === "history" && (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              Each history delta carries <code className="text-fg">asset_id</code>.
            </p>
            {history && (
              <ul className="max-h-80 space-y-1 overflow-y-auto">
                {history.txs.length === 0 && (
                  <li className="text-sm text-muted">No history entries.</li>
                )}
                {history.txs.map((t, i) => (
                  <li
                    key={`${t.tx}-${i}`}
                    className="flex items-center justify-between gap-2 rounded-md border border-border bg-bg px-2.5 py-1.5 font-mono text-[11px]"
                  >
                    <span className="min-w-0 truncate text-muted">
                      <span className="text-fg">{shortAssetLabel(t.assetId)}</span> {t.kind ?? "tx"}{" "}
                      · {t.tx.slice(0, 12)}…
                    </span>
                    <span className={t.delta >= 0 ? "shrink-0 text-ok" : "shrink-0 text-danger"}>
                      {t.delta >= 0 ? "+" : ""}
                      {fmtKvnc(t.delta)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-subtle">
              <code className="text-fg">GET /api/history?address=</code>
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
