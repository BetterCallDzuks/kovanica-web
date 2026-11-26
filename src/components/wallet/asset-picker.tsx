import { Coins, Gem, Landmark } from "lucide-react";
import { TOKEN, assetLabel, isNativeAsset } from "@/lib/api/contract";
import { KVNC_COIN_ICON, resolveTokenIcon } from "@/lib/tokens/icons";
import { cn } from "@/lib/utils";

export type AssetOption = {
  /** null = native KVNC */
  assetId: string | null;
  balance: number;
  label?: string;
  /** KVP-102: token symbol, shown instead of a truncated id. */
  symbol?: string;
  /** KVP-102: artwork URL (already validated by the decoder). */
  icon?: string;
  /** KVP-106: asset kind for visual distinction */
  kind?: "fungible" | "nft";
  /** KVP-106: metadata hash for NFTs */
  metadata_hash?: string | null;
  /** KVP-106: collection ID for NFTs */
  collection_id?: string | null;
  /** KVP-106: whether this is an RWA asset (fungible with special meaning) */
  is_rwa?: boolean;
};

type Props = {
  options: AssetOption[];
  value: string | null;
  onChange: (assetId: string | null) => void;
  disabled?: boolean;
  className?: string;
};

/**
 * Select which asset to spend. Native KVNC is always first.
 * When the node only returns native UTXOs, options will be a single entry.
 * NFTs (kind="nft") get distinct visual treatment.
 */
export function AssetPicker({ options, value, onChange, disabled, className }: Props) {
  const list =
    options.length > 0
      ? options
      : [{ assetId: null as string | null, balance: 0, label: TOKEN }];

const isNft = (opt: AssetOption) => opt.kind === "nft";
  const isRwa = (opt: AssetOption) => opt.is_rwa === true;
  const isSelected = (id: string | null) =>
    (isNativeAsset(value) && isNativeAsset(id)) ||
    (!isNativeAsset(value) && value === id);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <p className="text-[10px] tracking-wide text-subtle uppercase">Asset</p>
      <div className="flex flex-wrap gap-2">
        {list.map((opt) => {
          const id = opt.assetId;
          const selected = isSelected(id);
          const nft = isNft(opt);
          const rwa = isRwa(opt);
          const label = opt.label ?? opt.symbol ?? assetLabel(id);
          const icon = isNativeAsset(id)
            ? KVNC_COIN_ICON
            : resolveTokenIcon(opt.symbol ?? opt.label, opt.icon);

          return (
            <button
              key={id ?? "native"}
              type="button"
              disabled={disabled}
              onClick={() => onChange(isNativeAsset(id) ? null : id)}
              className={cn(
                "inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors relative",
                selected
                  ? nft
                    ? "border-purple-500/50 bg-purple-500/10 text-purple-400"
                    : rwa
                      ? "border-amber-500/50 bg-amber-500/10 text-amber-400"
                      : "border-gold/50 bg-gold/10 text-gold"
                  : nft
                    ? "border-purple-500/20 bg-purple-500/5 text-purple-400/80 hover:border-purple-500/40 hover:bg-purple-500/10"
                    : rwa
                      ? "border-amber-500/20 bg-amber-500/5 text-amber-400/80 hover:border-amber-500/40 hover:bg-amber-500/10"
                      : "border-border bg-surface text-muted hover:text-fg",
                disabled && "opacity-50",
              )}
            >
              {nft ? (
                <>
                  <Gem className="size-3.5" />
                  <span className="font-mono text-xs">{label}</span>
                  <span className="absolute -top-1 -right-1 bg-purple-600 text-white text-[8px] font-medium px-1 rounded">NFT</span>
                </>
              ) : rwa ? (
                <>
                  <Landmark className="size-3.5" />
                  <span className="font-mono text-xs">{label}</span>
                  <span className="absolute -top-1 -right-1 bg-amber-500 text-black text-[8px] font-medium px-1 rounded">RWA</span>
                </>
              ) : (
                <>
                  {icon ? (
                    <img src={icon} alt="" className="size-4 rounded-full object-cover" />
                  ) : (
                    <Coins className="size-3.5" />
                  )}
                  <span className="font-mono text-xs">{label}</span>
                </>
              )}
            </button>
          );
        })}
      </div>
      {!isNativeAsset(value) && (
        <p className="break-all font-mono text-[10px] text-subtle">
          {value?.replace(/^token:/, "")}
        </p>
      )}
    </div>
  );
}
