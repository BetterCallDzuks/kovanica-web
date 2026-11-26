/**
 * Canonical token & coin artwork helpers for Kovanica Web.
 *
 * - Native KVNC uses the official brand coin emblem (`/kvnc-coin.png`, mirrored
 *   from `BetterCallDzuks/kovanica-l1/brand-assets/kvnc-coin.png`).
 * - KVP-102 tokens with on-chain `icon` metadata (`https://…` or `data:image/…`)
 *   render their on-chain artwork; known Testnet tokens without on-chain icon
 *   bytes (such as `KSMOKE`) fall back to bundled static artwork in `/tokens/`.
 */

export const KVNC_COIN_ICON = "/kvnc-coin.png?v=2";

const FALLBACK_TOKEN_ICONS_BY_SYMBOL: Record<string, string> = {
  KVNC: KVNC_COIN_ICON,
  KSMOKE: "/tokens/ksmoke.png?v=2",
};

/** Resolve the best display icon URL for a token (on-chain icon wins over local fallback). */
export function resolveTokenIcon(symbol?: string | null, onChainIcon?: string | null): string | null {
  const trimmed = onChainIcon?.trim();
  if (trimmed && (trimmed.startsWith("https://") || trimmed.startsWith("data:image/") || trimmed.startsWith("/"))) {
    return trimmed;
  }
  if (!symbol) return null;
  return FALLBACK_TOKEN_ICONS_BY_SYMBOL[symbol.trim().toUpperCase()] ?? null;
}
