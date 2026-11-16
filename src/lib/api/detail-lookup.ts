import { notFound } from "@tanstack/react-router";
import { api, ApiError, HttpError } from "./client";
import { requestResponseStatus } from "../response-status";
import { isAssetId } from "../asset-id";

export { ASSET_ID_RE, isAssetId } from "../asset-id";

export type LookupKind = "nft" | "rwa" | "collection";

/**
 * HTTP status for a failed detail lookup. A missing or malformed id is a
 * not-found (404); anything upstream is 501/502/503 — never 500.
 */
export function lookupFailureStatus(status: number | undefined): 404 | 501 | 502 | 503 {
  if (status === 400 || status === 404) return 404;
  if (status === 501) return 501;
  if (status === 503) return 503;
  return 502;
}

function statusOf(err: unknown): number | undefined {
  if (err instanceof ApiError || err instanceof HttpError) return err.status;
  if (typeof err === "object" && err !== null && "status" in err) {
    const s = (err as { status: unknown }).status;
    if (typeof s === "number") return s;
  }
  return undefined;
}

/**
 * Shared loader for `/wallet/nft/$assetId`, `/explorer/rwa/$assetId` and
 * `/wallet/collection/$collectionId`. Throws `notFound()` (HTTP 404) for a
 * malformed id or an id the node does not know; rethrows upstream failures
 * after pinning the SSR status to 501/502/503.
 */
export async function loadDetail<T>(
  kind: LookupKind,
  id: string,
  search: unknown,
  isPresent: (data: T) => boolean,
): Promise<T> {
  if (!isAssetId(id)) throw notFound();
  const rawSource = (search as Record<string, unknown> | undefined)?.source;
  const query = typeof rawSource === "string" ? `?source=${encodeURIComponent(rawSource)}` : "";
  let data: T;
  try {
    data = await api<T>(`/api/${kind}/${encodeURIComponent(id)}${query}`);
  } catch (err) {
    const status = lookupFailureStatus(statusOf(err));
    if (status === 404) throw notFound();
    requestResponseStatus(status);
    throw err;
  }
  if (!data || !isPresent(data)) throw notFound();
  return data;
}
