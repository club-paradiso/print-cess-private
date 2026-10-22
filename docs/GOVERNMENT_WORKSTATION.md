# Government and public-sector workstation use

Print-cess can be used from a managed government or public-sector Windows workstation through the normal web application. The workstation flow is intentionally browser-only: it does not require a desktop installation, browser extension, local administrator rights, USB access, ActiveX, or a dedicated kiosk runtime.

The shared entry point for every device is `/start`. Legacy `/workstation` bookmarks redirect to `/start#environment`, which contains the same browser/network diagnostics. No separate workstation transfer implementation exists. The print display stays on `/kiosk` (and the legacy `/` route) until physical kiosk startup URLs are migrated and accepted.

## Supported operating model

Two directions are supported:

1. Phone to work computer: create a transfer on `/send` from the phone, then enter the two digits and shape it shows on `/receive` from the managed computer, or paste the transfer link there. Neither needs a camera.
2. Work computer to phone: create a transfer on `/send` from the managed computer, then open it on the phone by QR code, the two digits and shape, or the transfer link.

On the public home page these entrances sit in a secondary "At work or on a public computer" section, below the consumer Print, Share, and Scan capabilities.

The common start page provides an optional environment check before the user starts. The required capabilities are:

- HTTPS secure context;
- standards-compliant Web Crypto;
- the browser File, Blob, and FileReader APIs.

It also performs two network checks:

- the Print-cess API answers from this network (required — a proxy or allowlist that blocks the origin is reported here instead of failing mid-transfer);
- the deployment offers the same-origin storage route described below (advisory).

Normal browser download support is also checked. Ordinary browser downloads are the default receive path, even when richer file-system APIs are available; the user may explicitly opt into direct folder writes. The browser and agency download policies still apply.

## Browser baseline

Use a current Microsoft Edge or Chromium-based browser managed by the organization. Internet Explorer and Edge Internet Explorer mode are not supported. JavaScript must be enabled.

Print-cess does not attempt to work around browser policy, endpoint security, DLP, proxy inspection, download controls, network separation, or domain allowlists. A blocked capability is a deployment or agency-policy decision, not a condition the application should bypass.

## Network expectations

The user's browser should reach only the approved HTTPS Print-cess origin used by the deployment. Provider credentials and storage integrations remain server-side. If the organization uses an outbound allowlist, approve the exact deployed Print-cess origin rather than broad wildcard domains whenever possible.

### Same-origin storage route

By default the browser moves encrypted parts straight to blob storage on its own host (`<store>.private.blob.vercel-storage.com`). Managed networks often approve the Print-cess origin but block or categorise that storage host as cloud storage, which used to leave `/workstation` green while every transfer failed.

The deployment therefore also exposes each signed part operation at `/relay/blob/<path>?<signature>` on its own origin. A platform rewrite (`apps/web/src/server/blob-relay.ts`, wired in `next.config.ts`) forwards it to this deployment's own Vercel Blob store only; it is not an open proxy, and the signature, expiry, size limit, and end-to-end encryption are unchanged.

- Every device uses the same transfer engine: the storage host is attempted first and the relay is used after supported network refusals. A user may explicitly select same-origin transfer in the shared environment diagnostics to avoid the initial blocked request; this is not an agency-policy bypass.
- Everyone else tries the storage host first; if the network refuses it (network error, timeout, 403/407/451, or 5xx), the part is retried through the relay and the rest of the browser session stays on the relay.
- An agency allowlist therefore needs only the Print-cess origin.
- Set `PRINT_CESS_BLOB_RELAY=off` to disable the route. It is only available with the Vercel Blob provider; Railway S3 deployments still use the storage host directly.

Relayed bytes count toward the deployment's data transfer. Confirm on a representative workstation that an 8 MiB part passes through the relay; the platform's proxy limits for external rewrites apply.

A production deployment must continue to satisfy the requirements in `VERCEL_DEPLOYMENT.md` and the repository security documentation. Do not weaken the existing origin checks or production fail-closed behavior to make a managed workstation appear compatible.

## Information-handling boundary

End-to-end encryption protects transfer payloads from being readable by the service, but encryption does not override the organization's information-handling rules.

Before using Print-cess with an official document, verify that the document classification and the organization's rules permit transfer through an external web service. Development, Preview, fixtures, CI, and acceptance tests must never use real personal or official sensitive documents.

After receiving a file on a managed workstation:

- verify the actual save location;
- move the file only to an organization-approved location;
- remove the transfer promptly when appropriate;
- follow the organization's retention, DLP, malware-scanning, and document-handling rules.

## Deployment acceptance for an agency workstation

A green application CI build is not proof that a specific managed image is usable. Before enabling the workflow for real work, test on a representative agency-managed workstation with the same browser policies, endpoint security, proxy, and download rules as production users.

Minimum acceptance evidence should include:

- `/start` loads over HTTPS and `/workstation` redirects to `/start#environment`;
- the readiness panel reports HTTPS, Web Crypto, File API support, and a reachable Print-cess server;
- the browser's network log shows part uploads and downloads going to `/relay/blob/...` on the Print-cess origin, with no request to the storage host;
- a synthetic non-sensitive file can be sent from phone to workstation;
- a synthetic non-sensitive file can be sent from workstation to phone;
- the received bytes match the source bytes;
- the workstation's security software does not silently redirect or discard the download;
- no step requires local administrator rights or software installation;
- blocking a download or upload through policy produces a visible failure instead of a bypass attempt.

Keep this acceptance evidence separate from production documents.
