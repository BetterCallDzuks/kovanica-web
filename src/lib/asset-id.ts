/** NFT / RWA / collection ids are 32-byte hex digests, optionally 0x-prefixed. */
export const ASSET_ID_RE = /^(0x)?[0-9a-f]{64}$/i;

export function isAssetId(id: string): boolean {
  return ASSET_ID_RE.test(id.trim());
}
