import type { NextConfig } from "next";

import { blobRelayRewrites } from "./src/server/blob-relay";

const securityHeaders = [
  { key: "Cache-Control", value: "no-store, max-age=0" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  {
    key: "Permissions-Policy",
    // The receive flow uses the camera only after an explicit user tap to scan
    // the sender's QR code. `self` keeps that capability on this origin while
    // microphone, location, payment, and USB remain unavailable everywhere.
    value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=()",
  },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
    : []),
];

const config: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  devIndicators: false,
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  reactStrictMode: true,
  transpilePackages: [
    "@print-cess/crypto",
    "@print-cess/i18n",
    "@print-cess/protocol",
    "@print-cess/ui",
  ],
  async rewrites() {
    // Lets managed networks that approved this origin, but not the storage
    // host, still move ciphertext. See src/server/blob-relay.ts.
    return { beforeFiles: blobRelayRewrites(), afterFiles: [], fallback: [] };
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default config;
