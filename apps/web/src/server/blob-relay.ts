/**
 * Same-origin relay for drop ciphertext.
 *
 * Browsers normally move encrypted parts straight to blob storage on its own
 * host (`<store>.private.blob.vercel-storage.com`). A managed government or
 * public-sector network frequently allows the approved Print-cess origin while
 * its proxy blocks or categorises that storage host as "cloud storage", which
 * leaves the readiness check green and every transfer failing. The relay
 * gives the browser a second address for the very same signed operation:
 * `/relay/blob/<path>?<signature>` on this origin, which the platform proxies
 * to this deployment's own store.
 *
 * Nothing about the security model changes. The signature still authorizes a
 * single pathname, operation, size and expiry, the payload is still
 * end-to-end ciphertext, and the rewrite is pinned to the one store this
 * deployment owns, so it cannot be used as an open proxy. The relay is not a
 * way around agency policy either: it only lets a network that already
 * approved the Print-cess origin reach Print-cess.
 *
 * This file is imported by `next.config.ts`, so it must stay free of runtime
 * and path-alias imports.
 */

export const BLOB_RELAY_PREFIX = "/relay/blob";

const STORE_ID = /^[A-Za-z0-9]{1,64}$/;

type Environment = Readonly<Record<string, string | undefined>>;

/**
 * The deployment's Vercel Blob store, or null when ciphertext does not live in
 * Vercel Blob or the relay was switched off. Read/write tokens have the shape
 * `vercel_blob_rw_<storeId>_<secret>`, which is how the Blob SDK itself finds
 * the store.
 */
export function relayStoreId(environment: Environment = process.env): string | null {
  if (environment.PRINT_CESS_BLOB_RELAY === "off") return null;
  const provider = environment.PRINT_CESS_BLOB_PROVIDER;
  if (provider && provider !== "vercel-blob") return null;
  const token = environment.BLOB_READ_WRITE_TOKEN ?? "";
  const parts = token.split("_");
  if (parts.length < 5 || parts[0] !== "vercel" || parts[1] !== "blob" || parts[2] !== "rw") {
    return null;
  }
  const storeId = parts[3] ?? "";
  return STORE_ID.test(storeId) ? storeId : null;
}

function storeHost(storeId: string): string {
  return `${storeId}.private.blob.vercel-storage.com`.toLowerCase();
}

/** The rewrite that backs the relay, or nothing when the relay is unavailable. */
export function blobRelayRewrites(
  environment: Environment = process.env,
): { source: string; destination: string }[] {
  const storeId = relayStoreId(environment);
  if (!storeId) return [];
  return [
    {
      source: `${BLOB_RELAY_PREFIX}/:path*`,
      destination: `https://${storeHost(storeId)}/:path*`,
    },
  ];
}

/**
 * The same-origin address for a signed operation, or undefined when the
 * operation does not target this deployment's store. Only the host changes;
 * the path and the signed query string are carried over byte for byte.
 */
export function relayUrlFor(
  signedUrl: string,
  environment: Environment = process.env,
): string | undefined {
  const storeId = relayStoreId(environment);
  if (!storeId) return undefined;
  let url: URL;
  try {
    url = new URL(signedUrl);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" || url.hostname !== storeHost(storeId)) return undefined;
  if (url.username || url.password || url.port) return undefined;
  return `${BLOB_RELAY_PREFIX}${url.pathname}${url.search}`;
}
