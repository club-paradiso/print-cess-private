# Security policy

## Supported versions

Until a stable release exists, only the latest commit on the protected default branch is eligible
for security fixes. Feature branches and Preview deployments are test environments and must never
process real documents.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability, exposed credential, personal document, or
signed URL. Use the repository's GitHub **Security > Advisories > Report a vulnerability** flow.
Include affected commit/version, impact, safe reproduction steps using synthetic data, and any
suggested mitigation. Do not attach a real travel, identity, or immigration document.

The maintainers target acknowledgement within three business days and an initial severity/next-step
update within seven business days. Timing can change for coordinated disclosure or institutional
incident response. If a live credential is exposed, revoke it immediately; never wait for code
remediation.

## Security invariants

- One session, one claiming phone, one object, one consume, and at most one print submission.
- Plaintext exists only on the visitor's phone and transiently in the managed kiosk.
- Neither Vercel Route Handlers nor Blob/Redis/QStash credentials can derive the document key.
- Ciphertext never traverses a Vercel Function request or response.
- Original filenames and document identifiers never enter Blob pathnames, session state, logs, or
  metrics.
- All success, failure, cancellation, expiry, and restart paths converge on cleanup.
- Unknown print submission state is a failure with no automatic retry.

## Tokens and sessions

- Generate session IDs with at least 128 bits of CSPRNG entropy and upload/kiosk tokens with 256
  bits. Tokens are independent and one-time.
- Put the upload token and kiosk-key fingerprint in the QR fragment, never a query string. Reject
  a missing or malformed fragment.
- The QR image is the only place a Production kiosk publishes that fragment. Do not also write the
  session URL into page text, a DOM attribute, a log line, or a test hook that ships to Production.
- When a visit ends, empty every store the origin can reach and answer with `Clear-Site-Data` for
  cache, cookies, and storage. Never include `executionContexts`: reloading a spent session replaces
  the visitor's confirmation with an error. Claim only what this reaches — not browser history, and
  not the browser process. See `docs/PRIVACY.md`.
- Store only domain-separated SHA-256 token hashes. Protocol version 1 hashes the canonical
  32-byte token after
  `UTF8("print-cess-by-paradiso:token-hash:<role>:v1") || 00`, where role is upload, kiosk, or
  mobile. Compare decoded fixed-length digests without early exit.
- Keep waiting and claimed work windows to three minutes. Cap every signed URL to `expiresAt` and
  use the shortest practical per-operation lifetime.
- Use Redis Lua or equivalent revision compare-and-set for claim, upload authorization/completion,
  consume, terminal seal, and delete. Reject all invalid transitions.
- Apply per-IP and per-session limits without long-term IP storage. Return generic authentication
  and existence responses that do not aid enumeration.
- Set `Cache-Control: no-store` on session APIs and do not put tokens in cookies or browser storage.

## Encryption

Protocol version 1 uses ECDH P-256, HKDF-SHA-256, and AES-256-GCM with a fresh 32-byte salt and
12-byte IV. The entire binary header and session/fingerprint context are authenticated. The kiosk
private key remains in process memory. See `CRYPTOGRAPHY.md` for the normative layout and rejection
rules.

Encryption does not protect against malicious frontend JavaScript, kiosk compromise, plaintext
spool data, or abandoned paper. Those boundaries must not be described as end-to-end guarantees
beyond the stated threat model.

## File handling

- Accept validated PDF, JPEG, PNG, HWP, HWPX, or authenticated print bundles; 10 MiB per document and 32 MiB per bundle. The kiosk enforces an absolute 50-page ceiling after rendering.
- Mobile validation improves feedback. Kiosk validation is mandatory after authenticated
  decryption and checks magic bytes, actual type, bounded size, file-kind match, parse/decode
  success, page count, PDF encryption/actions, and image dimensions/resource budget.
- Reject HWP, Office formats, archives, HTML, SVG, executables, locked/damaged PDF, malformed
  images, disguised extensions, and unsupported image encodings.
- Size the image budget so that current phone-camera output — 48 MP stills and panoramas longer
  than 12,000 pixels on one edge — is accepted, and separate a decompression bomb from a real
  photograph by requiring a minimum pixel density per compressed byte rather than by lowering the
  pixel ceiling. Rejecting a visitor's ordinary photograph as damaged is a defect, not caution.
- Do not compare a decoded bitmap's width and height against the stored dimensions without
  allowing the transposed form. Browsers disagree about applying the EXIF orientation tag, so a
  photo taken sideways legitimately decodes with its axes swapped.
- Do not execute PDF JavaScript, OpenAction, Launch actions, attachments, external links, or embed a
  PDF as active HTML. Because a PDF name may hex-escape any character, scan for those markers in
  both the raw bytes and the form with `#xx` escapes decoded; a substring scan of the raw bytes
  alone is bypassed by escaping one letter of the name.
- Keep plaintext in bounded memory. If a renderer requires a temporary file, use an
  application-owned ACL-restricted directory, random name, immediate deletion, and startup cleanup.
  Never use the original filename, Downloads, or Documents.

## HTTP and browser hardening

Production must define exact HTTPS origins; CORS `*` is forbidden. Separate development and
Production origin lists. Apply schema validation, content-length limits, timeouts, rate limits, and
small JSON-only Route Handlers. Use at least:

- a restrictive CSP with `default-src 'self'` and no unreviewed third-party scripts;
- `frame-ancestors 'none'`, `object-src 'none'`, and `base-uri 'none'`;
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, a restrictive
  `Permissions-Policy`, and HSTS in Production;
- private production source maps and sanitized error bodies;
- QStash signature verification with current and next signing keys before cleanup.

Blob URLs are bearer credentials. Never log the complete URL, send it to analytics, render it in
support UI, or retain it after the operation.

## Logs and diagnostics

Use allow-listed structured event fields and stable error codes. Redact Authorization, Cookie,
URL fragments, raw tokens, token hashes, signed URLs, public/private keys, filenames, document
bytes, person/contact/identity/reservation values, stack traces, and internal paths. Provider error
bodies are diagnostic-only and never returned to visitors.

Metrics are disabled by default. If approved, only aggregate success, rejection, upload failure,
printer error, and duration counts are allowed, with no persistent session identifier or deliberate
IP capture.

## Secrets

- Store Vercel, Blob, Redis, QStash, kiosk registration, administrator, code-signing, and release
  credentials only in approved secret stores or protected environment variables.
- Use separate credentials/resources for local, Preview, and Production. Never copy Production
  credentials to Preview.
- The current Production startup gate requires a scoped `BLOB_READ_WRITE_TOKEN`; rotate it and keep
  it from the phone and kiosk. Vercel OIDC plus a specific Blob store ID is the preferred future
  direction, but OIDC-only operation needs an explicit implementation change and Preview test
  before removing the token requirement.
- Keep QStash current/next signing keys together during rotation. Rotate registration/admin
  credentials after personnel or device changes.
- Administrator authentication stores a modern salted password hash, never a hard-coded password.
- Treat a committed secret as compromised even if later removed; revoke, rotate, audit, and purge
  history only under an incident procedure.

No production credentials were present or used during the initial implementation.

## Dependency and supply-chain policy

- Commit `pnpm-lock.yaml` and NuGet lock data where supported; use frozen/locked restore in CI.
- Pin direct dependency versions. Dependabot covers npm/pnpm, NuGet, and GitHub Actions weekly.
- CI runs pnpm audit, a NuGet vulnerable-package check, and a secret-scanning helper. The workflow
  defines CodeQL for JavaScript/TypeScript and C#, gated by `ENABLE_CODEQL=true`. GitHub returned
  403/422 because this private personal repository lacks native code/secret scanning entitlement;
  upgrade or move it before enabling those jobs and push protection.
- Review package provenance, maintainer activity, security history, transitive graph, and license
  before adding a parser, renderer, crypto package, Action, or native binary.
- Raise the floor on a vulnerable transitive dependency with a ranged `overrides` entry in
  `pnpm-workspace.yaml` — `nanoid@<3.3.17: 3.3.17`, in the shape `undici` already uses — rather than
  a bare pin, so a package that legitimately needs a different major is not dragged backwards. Take
  the lowest version the advisory accepts unless a later one fixes something the changelog names;
  the advisory's floor has had the most time in the field, which is the point of the release-age
  delay this workspace runs under.
- Require CODEOWNERS review for cryptography, protocol, API, kiosk infrastructure, and workflows.
- Produce a SHA-256 checksum for kiosk artifacts. The release workflow now requires Authenticode
  signing and `/pa` verification in `windows-signing`; Production still requires an approved
  certificate/custody model and independent target-device verification.
- Major-version Action tags receive Dependabot review. Institutional policy may require immutable
  commit-SHA pinning before Production.

## Repository controls

`main` now requires strict pull requests, conversation resolution, Web/Windows/dependency/Gitleaks
checks, linear history, admin enforcement, and no force-push/delete. The solo personal repository
cannot require an independent self-review. `vercel-preview` is restricted to `main`, while
`windows-signing` and `github-release` accept only `v*` tag refs; the release workflow also requires
the input tag, workflow ref, commit, and protected-main ancestry to agree. Active ruleset `19197379`
restricts creation, update, and deletion of matching release tags to the repository owner's
bypass. Institutional ownership must still add approval/CODEOWNER review and migrate that bypass to
an approved release role before Production. Use Conventional Commits and a Draft PR until evidence
is complete.

GitHub Release and Vercel Production deployment remain prohibited. See `GITHUB_WORKFLOW.md`.
