import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const OCR_ASSET_ORIGINS = ["https://cdn.jsdelivr.net", "https://tessdata.projectnaptha.com"];

/**
 * Both halves of the service upload and download ciphertext straight from the
 * browser to blob storage, so the configured provider's origin has to be
 * connectable. Only the selected provider is admitted; an unset or malformed
 * S3 endpoint simply contributes nothing rather than widening the policy.
 */
export function blobConnectOrigins(environment: NodeJS.ProcessEnv = process.env): string[] {
  if (environment.PRINT_CESS_BLOB_PROVIDER !== "railway-s3") {
    return [
      "https://vercel.com",
      "https://*.blob.vercel-storage.com",
      "https://blob.vercel-storage.com",
    ];
  }
  const endpoint = environment.S3_ENDPOINT;
  if (!endpoint) return [];
  let origin: string;
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:") return [];
    origin = url.origin;
  } catch {
    return [];
  }
  const bucket = environment.S3_BUCKET;
  // Virtual-hosted addressing puts the bucket in front of the endpoint host,
  // so that form is admitted too unless the deployment forces path style.
  if (!bucket || environment.S3_FORCE_PATH_STYLE === "true") return [origin];
  const url = new URL(origin);
  return [origin, `${url.protocol}//${bucket}.${url.host}`];
}

export function buildContentSecurityPolicy(
  nonce: string,
  isDevelopment: boolean,
  environment: NodeJS.ProcessEnv = process.env,
  isScannerRoute = false,
): string {
  const connectSources = ["'self'", ...blobConnectOrigins(environment), ...OCR_ASSET_ORIGINS].join(
    " ",
  );
  // The bundled OpenCV Emscripten glue invokes new Function() even though
  // WebAssembly compilation itself only needs wasm-unsafe-eval. Production
  // scanner tests confirmed that denying unsafe-eval breaks edge detection.
  // Scope the exception to /scan; never weaken the other app routes.
  const allowScannerRuntime = isDevelopment || isScannerRoute;
  const scriptEvaluation = ` 'wasm-unsafe-eval'${allowScannerRuntime ? " 'unsafe-eval'" : ""}`;
  return [
    "default-src 'self'",
    "base-uri 'none'",
    isScannerRoute ? "frame-ancestors 'self'" : "frame-ancestors 'none'",
    "form-action 'self'",
    "object-src 'none'",
    "font-src 'self'",
    "frame-src 'self' blob:",
    "img-src 'self' blob: data:",
    "media-src 'self' blob:",
    `connect-src ${connectSources}`,
    `script-src 'self' https://cdn.jsdelivr.net 'nonce-${nonce}' 'strict-dynamic'${scriptEvaluation}`,
    "script-src-attr 'none'",
    // WebKit rejects scanner dynamic styles if nonce propagation fails. Only
    // the scanner permits inline styles; all other production pages stay nonce-only.
    `style-src 'self' ${allowScannerRuntime ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,
    "worker-src 'self' blob: https://cdn.jsdelivr.net",
    ...(isDevelopment ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const contentSecurityPolicy = buildContentSecurityPolicy(
    nonce,
    process.env.NODE_ENV === "development",
    process.env,
    request.nextUrl.pathname === "/scan",
  );
  const requestHeaders = new Headers(request.headers);

  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", contentSecurityPolicy);

  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|relay/|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
