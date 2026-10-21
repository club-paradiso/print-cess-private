
export const BLOB_RELAY_PREFIX = "/relay/blob";

const STORE_ID = /^[A-Za-z0-9]{1,64}$/;

type Environment = Readonly<Record<string, string | undefined>>;

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
