/**
 * KVP-106 Native NFTs — Create Collection & Mint NFT end-to-end on Testnet (Chain 2).
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Image,
  Sparkles,
  Layers,
  Wallet,
  Loader2,
  CheckCircle2,
  Copy,
  ExternalLink,
  Gem,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ATOM, FIXED_FEES, TOKEN } from "@/lib/networkConstants";
import { useLedger } from "@/lib/ledger/store";
import { hexToKvnc, parseAddr } from "@/lib/wallet/address";
import { shortId } from "@/lib/ledger/hash";
import {
  connectExtensionSigner,
  deployAndCreateNft,
  getKovanicaExtension,
  mintNftInCollection,
  webWalletSigner,
  type ActiveSigner,
} from "@/lib/wallet/tx-builder";

type NftTab = "create" | "mint";

interface NftSuccess {
  collectionHex: string;
  collectionKvnc: string;
  deployTxHash?: string;
  collectionTxHash?: string;
  mintTxHash?: string;
  tokenId?: string;
}

export function NftView() {
  const wallet = useLedger((s) => s.wallet);
  const [tab, setTab] = useState<NftTab>("create");
  const [extSigner, setExtSigner] = useState<ActiveSigner | null>(null);

  // Create collection + optional initial mint fields
  const [collectionName, setCollectionName] = useState("");
  const [collectionSymbol, setCollectionSymbol] = useState("");
  const [nftName, setNftName] = useState("");
  const [nftDescription, setNftDescription] = useState("");
  const [imageUri, setImageUri] = useState("");
  const [recipient, setRecipient] = useState("");
  const [tokenId, setTokenId] = useState("1");
  const [mintNow, setMintNow] = useState(true);

  // Mint into existing collection fields
  const [existingCollection, setExistingCollection] = useState("");

  // Execution state
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [result, setResult] = useState<NftSuccess | null>(null);

  const unlockedSigner = useMemo(() => webWalletSigner(wallet), [wallet]);
  const activeSigner = unlockedSigner ?? extSigner;
  const hasExtension = useMemo(() => getKovanicaExtension() !== null, []);

  useEffect(() => {
    if (!recipient && activeSigner) {
      setRecipient(activeSigner.addressKvnc);
    } else if (!recipient && wallet?.address) {
      setRecipient(hexToKvnc(wallet.address));
    }
  }, [activeSigner, recipient, wallet?.address]);

  async function onConnectExtension() {
    try {
      const signer = await connectExtensionSigner();
      setExtSigner(signer);
      setRecipient(signer.addressKvnc);
      toast.success(`Connected ${shortId(signer.addressKvnc)}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Extension connection failed");
    }
  }

  function normalizeMediaUri(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed) return "";
    if (
      trimmed.startsWith("https://") ||
      trimmed.startsWith("http://") ||
      trimmed.startsWith("ipfs://") ||
      trimmed.startsWith("data:image/")
    ) {
      return trimmed;
    }
    // Treat bare CID (Qm... or bafy...) as ipfs://
    if (/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|bafy[a-zA-Z0-9]{20,})$/.test(trimmed)) {
      return `ipfs://${trimmed}`;
    }
    return trimmed;
  }

  function buildTokenUri(): string {
    const media = normalizeMediaUri(imageUri);
    if (media) return media;
    // Inline JSON metadata fallback when no external URL/CID is supplied
    const meta = {
      name: nftName.trim() || `${collectionName.trim() || "Kovanica NFT"} #${tokenId.trim() || "1"}`,
      description: nftDescription.trim() || "Minted on Kovanica Testnet (KVP-106)",
    };
    return `data:application/json;utf8,${encodeURIComponent(JSON.stringify(meta))}`;
  }

  async function onCreateCollectionAndMint() {
    if (!activeSigner) {
      toast.error("Unlock your Web Wallet on /wallet or connect window.kovanica first");
      return;
    }
    const name = collectionName.trim();
    const symbol = collectionSymbol.trim();
    if (!name || name.length > 64) {
      toast.error("Collection name is required (1–64 characters)");
      return;
    }
    if (!symbol || symbol.length > 16 || /\s/.test(symbol)) {
      toast.error("Collection symbol is required (1–16 characters, no spaces)");
      return;
    }
    const parsedId = /^\d+$/.test(tokenId.trim()) ? BigInt(tokenId.trim()) : null;
    if (mintNow && (parsedId === null || parsedId < 0n)) {
      toast.error("Token ID must be a non-negative integer");
      return;
    }
    const destHex = parseAddr(recipient.trim() || activeSigner.addressKvnc);
    if (mintNow && !destHex) {
      toast.error("Recipient must be a valid kvnc…dag or 64-hex address");
      return;
    }

    setBusy(true);
    setResult(null);
    setStatusMsg("Preparing KVP-106 collection deploy…");

    try {
      const uri = buildTokenUri();
      const res = await deployAndCreateNft(activeSigner, {
        collectionName: name,
        collectionSymbol: symbol,
        baseUri: normalizeMediaUri(imageUri),
        mintNow,
        recipient: destHex ?? activeSigner.addressHex,
        tokenId: parsedId ?? 1n,
        tokenUri: uri,
        onStatus: (m) => setStatusMsg(m),
      });
      setResult({
        collectionHex: res.collectionHex,
        collectionKvnc: res.collectionKvnc,
        deployTxHash: res.deployTxHash,
        collectionTxHash: res.collectionTxHash,
        mintTxHash: res.mintTxHash,
        tokenId: res.tokenId?.toString(),
      });
      setStatusMsg(null);
      toast.success(
        res.mintTxHash
          ? `Collection ${symbol} created & NFT #${res.tokenId} minted!`
          : `Collection ${symbol} created on Testnet!`,
      );
    } catch (e) {
      setStatusMsg(null);
      toast.error(e instanceof Error ? e.message : "NFT creation failed");
    } finally {
      setBusy(false);
    }
  }

  async function onMintExisting() {
    if (!activeSigner) {
      toast.error("Unlock your Web Wallet on /wallet or connect window.kovanica first");
      return;
    }
    const colHex = parseAddr(existingCollection.trim());
    if (!colHex) {
      toast.error("Enter a valid collection contract address (kvnc…dag or 64-hex)");
      return;
    }
    const destHex = parseAddr(recipient.trim() || activeSigner.addressKvnc);
    if (!destHex) {
      toast.error("Recipient must be a valid kvnc…dag or 64-hex address");
      return;
    }
    const parsedId = /^\d+$/.test(tokenId.trim()) ? BigInt(tokenId.trim()) : null;
    if (parsedId === null || parsedId < 0n) {
      toast.error("Token ID must be a non-negative integer");
      return;
    }

    setBusy(true);
    setResult(null);
    setStatusMsg("Signing nft_mint transaction…");

    try {
      const res = await mintNftInCollection(activeSigner, {
        collection: colHex,
        to: destHex,
        tokenId: parsedId,
        tokenUri: buildTokenUri(),
        onStatus: (m) => setStatusMsg(m),
      });
      setResult({
        collectionHex: res.collectionHex,
        collectionKvnc: hexToKvnc(res.collectionHex),
        mintTxHash: res.txHash,
        tokenId: parsedId.toString(),
      });
      setStatusMsg(null);
      toast.success(`NFT #${parsedId} minted on Testnet!`);
    } catch (e) {
      setStatusMsg(null);
      toast.error(e instanceof Error ? e.message : "NFT mint failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-8 md:px-8">
      <div className="flex items-center gap-3">
        <Image className="size-5 text-purple-400" />
        <h1 className="font-display text-3xl tracking-tight text-fg italic md:text-4xl">
          Native NFTs
        </h1>
      </div>

      <p className="mt-2 font-mono text-[11px] tracking-brand text-purple-400 uppercase">
        KVP-106 · Testnet Chain 2 Live
      </p>

      <div className="mt-3 inline-flex w-fit items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-400">
        <span className="size-1.5 rounded-full bg-emerald-400" />
        Interactive · Client-side signing via Web Wallet or window.kovanica
      </div>

      <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted">
        Create a KVP-106 NFT collection and mint non-fungible tokens directly on Kovanica Testnet
        (Chain 2) with canonical Ed25519 signing and <code className="text-fg">kovanica_sendRawTransaction</code>.
      </p>

      {/* Mode switch */}
      <div className="mt-6 inline-flex w-fit rounded-md bg-surface-2 p-0.5">
        {(
          [
            { id: "create" as const, label: "Create Collection & Mint", icon: Layers },
            { id: "mint" as const, label: "Mint into Collection", icon: Sparkles },
          ] as const
        ).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setTab(id);
              setResult(null);
            }}
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

      <div className="mt-6 rounded-xl border border-border bg-surface p-5 space-y-5">
        {/* Signer bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-bg px-3.5 py-2.5 text-xs">
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
              <span>Unlock your Web Wallet or connect window.kovanica to sign NFT transactions.</span>
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

        {tab === "create" ? (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium tracking-wide text-subtle uppercase">
                  Collection Name
                </label>
                <input
                  className="mt-1.5 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg placeholder:text-subtle focus:outline-none focus:ring-1 focus:ring-blue"
                  placeholder="e.g. Kovanica Genesis Pass"
                  value={collectionName}
                  onChange={(e) => setCollectionName(e.target.value)}
                  maxLength={64}
                  disabled={busy}
                />
              </div>
              <div>
                <label className="block text-xs font-medium tracking-wide text-subtle uppercase">
                  Collection Symbol
                </label>
                <input
                  className="mt-1.5 w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm text-fg placeholder:text-subtle focus:outline-none focus:ring-1 focus:ring-blue"
                  placeholder="e.g. KGP"
                  value={collectionSymbol}
                  onChange={(e) => setCollectionSymbol(e.target.value.toUpperCase())}
                  maxLength={16}
                  disabled={busy}
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs text-muted cursor-pointer select-none">
              <input
                type="checkbox"
                checked={mintNow}
                onChange={(e) => setMintNow(e.target.checked)}
                disabled={busy}
                className="rounded border-border"
              />
              Mint first NFT immediately after creating the collection
            </label>

            {mintNow && (
              <div className="grid gap-4 sm:grid-cols-2 rounded-lg border border-border bg-bg/60 p-4">
                <div>
                  <label className="block text-xs font-medium tracking-wide text-subtle uppercase">
                    NFT Name
                  </label>
                  <input
                    className="mt-1.5 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg placeholder:text-subtle focus:outline-none focus:ring-1 focus:ring-blue"
                    placeholder="e.g. Genesis #1"
                    value={nftName}
                    onChange={(e) => setNftName(e.target.value)}
                    disabled={busy}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium tracking-wide text-subtle uppercase">
                    Token ID
                  </label>
                  <input
                    className="mt-1.5 w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm text-fg placeholder:text-subtle focus:outline-none focus:ring-1 focus:ring-blue"
                    value={tokenId}
                    onChange={(e) => setTokenId(e.target.value)}
                    inputMode="numeric"
                    disabled={busy}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium tracking-wide text-subtle uppercase">
                    Description
                  </label>
                  <input
                    className="mt-1.5 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg placeholder:text-subtle focus:outline-none focus:ring-1 focus:ring-blue"
                    placeholder="Short description of this NFT"
                    value={nftDescription}
                    onChange={(e) => setNftDescription(e.target.value)}
                    disabled={busy}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium tracking-wide text-subtle uppercase">
                    Image URL or IPFS CID (optional)
                  </label>
                  <input
                    className="mt-1.5 w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm text-fg placeholder:text-subtle focus:outline-none focus:ring-1 focus:ring-blue"
                    placeholder="https://… or ipfs://bafy… or bare CID"
                    value={imageUri}
                    onChange={(e) => setImageUri(e.target.value)}
                    disabled={busy}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium tracking-wide text-subtle uppercase">
                    Recipient Address
                  </label>
                  <input
                    className="mt-1.5 w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm text-fg placeholder:text-subtle focus:outline-none focus:ring-1 focus:ring-blue"
                    placeholder="kvnc…dag or 64-hex"
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                    disabled={busy}
                  />
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium tracking-wide text-subtle uppercase">
                Collection Contract Address
              </label>
              <input
                className="mt-1.5 w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm text-fg placeholder:text-subtle focus:outline-none focus:ring-1 focus:ring-blue"
                placeholder="kvnc…dag or 64-hex collection address"
                value={existingCollection}
                onChange={(e) => setExistingCollection(e.target.value)}
                disabled={busy}
              />
            </div>
            <div>
              <label className="block text-xs font-medium tracking-wide text-subtle uppercase">
                NFT Name
              </label>
              <input
                className="mt-1.5 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg placeholder:text-subtle focus:outline-none focus:ring-1 focus:ring-blue"
                placeholder="e.g. Artifact #2"
                value={nftName}
                onChange={(e) => setNftName(e.target.value)}
                disabled={busy}
              />
            </div>
            <div>
              <label className="block text-xs font-medium tracking-wide text-subtle uppercase">
                Token ID
              </label>
              <input
                className="mt-1.5 w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm text-fg placeholder:text-subtle focus:outline-none focus:ring-1 focus:ring-blue"
                value={tokenId}
                onChange={(e) => setTokenId(e.target.value)}
                inputMode="numeric"
                disabled={busy}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium tracking-wide text-subtle uppercase">
                Image URL or IPFS CID (optional)
              </label>
              <input
                className="mt-1.5 w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm text-fg placeholder:text-subtle focus:outline-none focus:ring-1 focus:ring-blue"
                placeholder="https://… or ipfs://bafy… or bare CID"
                value={imageUri}
                onChange={(e) => setImageUri(e.target.value)}
                disabled={busy}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium tracking-wide text-subtle uppercase">
                Recipient Address
              </label>
              <input
                className="mt-1.5 w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm text-fg placeholder:text-subtle focus:outline-none focus:ring-1 focus:ring-blue"
                placeholder="kvnc…dag or 64-hex"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                disabled={busy}
              />
            </div>
          </div>
        )}

        {/* Balanced fee schedule */}
        <div className="rounded-lg border border-border bg-bg p-3.5 text-xs text-muted space-y-1.5">
          {tab === "create" && (
            <>
              <div className="flex justify-between">
                <span>
                  Contract Deploy (<code className="text-fg">Deploy</code>)
                </span>
                <span className="font-mono text-fg">
                  {FIXED_FEES.deploy / ATOM} {TOKEN}
                </span>
              </div>
              <div className="flex justify-between">
                <span>
                  Create Collection (<code className="text-fg">nft_create_collection</code>)
                </span>
                <span className="font-mono text-fg">
                  {FIXED_FEES.nft_create_collection / ATOM} {TOKEN}
                </span>
              </div>
            </>
          )}
          {(tab === "mint" || mintNow) && (
            <div className="flex justify-between">
              <span>
                Mint NFT (<code className="text-fg">nft_mint</code>)
              </span>
              <span className="font-mono text-fg">
                {FIXED_FEES.nft_mint / ATOM} {TOKEN}
              </span>
            </div>
          )}
          <p className="pt-1 text-[11px] text-subtle">
            Balanced-tier fixed fee schedule (75% burned, 25% block miner). Transactions are signed
            client-side and submitted via <code className="text-fg">kovanica_sendRawTransaction</code>.
          </p>
        </div>

        {statusMsg && (
          <div className="flex items-center gap-2 rounded-lg border border-blue/30 bg-blue/10 px-3.5 py-2.5 text-xs text-blue">
            <Loader2 className="size-4 shrink-0 animate-spin" />
            <span>{statusMsg}</span>
          </div>
        )}

        <Button
          type="button"
          className="w-full h-11"
          disabled={busy || !activeSigner}
          onClick={() =>
            void (tab === "create" ? onCreateCollectionAndMint() : onMintExisting())
          }
        >
          {busy ? (
            <>
              <Loader2 className="size-4 mr-2 animate-spin" />
              Signing &amp; Broadcasting…
            </>
          ) : tab === "create" ? (
            <>
              <Sparkles className="size-4 mr-2" />
              {mintNow ? "Create Collection & Mint NFT" : "Create NFT Collection"}
            </>
          ) : (
            <>
              <Gem className="size-4 mr-2" />
              Mint NFT
            </>
          )}
        </Button>

        {result && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 space-y-3">
            <div className="flex items-center gap-2 text-emerald-400">
              <CheckCircle2 className="size-5" />
              <h3 className="font-medium">
                {result.mintTxHash ? "NFT Minted on Testnet!" : "Collection Created on Testnet!"}
              </h3>
            </div>
            <div className="space-y-1.5 font-mono text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted">Collection</span>
                <span className="truncate text-fg">{result.collectionKvnc}</span>
              </div>
              {result.deployTxHash && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted">Deploy Tx</span>
                  <span className="truncate text-fg">{shortId(result.deployTxHash)}</span>
                </div>
              )}
              {result.collectionTxHash && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted">Collection Tx</span>
                  <span className="truncate text-fg">{shortId(result.collectionTxHash)}</span>
                </div>
              )}
              {result.mintTxHash && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted">Mint Tx (#{result.tokenId ?? "1"})</span>
                  <span className="truncate text-fg">{shortId(result.mintTxHash)}</span>
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(result.collectionKvnc)
                    .then(() => toast.success("Collection address copied"))
                }
              >
                <Copy className="size-3.5 mr-1.5" />
                Copy Collection
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link to="/wallet/nft/$assetId" params={{ assetId: result.collectionHex }}>
                  <Gem className="size-3.5 mr-1.5" />
                  View NFT Detail
                </Link>
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
