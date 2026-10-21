import { describe, expect, it } from "vitest";

import { blobRelayRewrites, relayStoreId, relayUrlFor } from "./blob-relay";

const TOKEN = "vercel_blob_rw_AbC123xyz_secretpart";
const environment = { BLOB_READ_WRITE_TOKEN: TOKEN };

describe("blob relay", () => {
  it("reads the store from the read/write token", () => {
    expect(relayStoreId(environment)).toBe("AbC123xyz");
  });

  it("is unavailable without Vercel Blob, with a malformed token, or when switched off", () => {
    expect(relayStoreId({})).toBeNull();
    expect(relayStoreId({ BLOB_READ_WRITE_TOKEN: "nonsense" })).toBeNull();
    expect(relayStoreId({ BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_a.b/c_secret" })).toBeNull();
    expect(relayStoreId({ ...environment, PRINT_CESS_BLOB_PROVIDER: "railway-s3" })).toBeNull();
    expect(relayStoreId({ ...environment, PRINT_CESS_BLOB_RELAY: "off" })).toBeNull();
    expect(blobRelayRewrites({})).toEqual([]);
  });

  it("pins the rewrite to this deployment's own store", () => {
    expect(blobRelayRewrites(environment)).toEqual([
      {
        source: "/relay/blob/:path*",
        destination: "https://abc123xyz.private.blob.vercel-storage.com/:path*",
      },
    ]);
  });

  it("moves a signed operation to this origin without touching its path or signature", () => {
    const signed =
      "https://abc123xyz.private.blob.vercel-storage.com/drops/Q/3?vercel-blob-signature=x%2By&ttl=9";
    expect(relayUrlFor(signed, environment)).toBe(
      "/relay/blob/drops/Q/3?vercel-blob-signature=x%2By&ttl=9",
    );
  });

  it("refuses to relay any other host", () => {
    expect(
      relayUrlFor("https://other.private.blob.vercel-storage.com/drops/Q/3", environment),
    ).toBeUndefined();
    expect(relayUrlFor("https://example.com/drops/Q/3", environment)).toBeUndefined();
    expect(
      relayUrlFor("http://abc123xyz.private.blob.vercel-storage.com/drops/Q/3", environment),
    ).toBeUndefined();
    expect(relayUrlFor("not a url", environment)).toBeUndefined();
  });
});
