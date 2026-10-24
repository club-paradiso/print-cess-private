# Print-cess by Paradiso implementation plan

Status snapshot: 2026-07-20. This is an implementation and verification record, not a production
approval.

## Outcome and boundaries

Print-cess by Paradiso provides secure self-service document printing from a visitor's phone to a
single managed Windows kiosk. The normal path needs no public Wi-Fi, desktop interaction, account
login, or staff handling of the visitor's phone. One session accepts one PDF, JPEG, or PNG, prints
one A4 black-and-white single-sided copy, and then removes the encrypted object and session.

Only `apps/web` is a Vercel workload. The WPF application is built and distributed separately for
Windows. Development and CI use synthetic fixtures and local or mock adapters; real personal
documents are prohibited.

## Environment discovered

| Item                       | Observed or selected value                                        | Consequence                                                                                                            |
| -------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Repository                 | `club-paradiso/print-cess`                                        | No implementation is pushed directly to `main`.                                                                        |
| Working branch             | Short-lived `agent/*` branches                                    | Readiness work enters protected `main` only through a PR with required checks.                                         |
| Local host                 | macOS 15.6.1, arm64                                               | WPF, Windows printer APIs, Shell Launcher, and a physical printer cannot be validated locally.                         |
| Local Node.js              | 24.14.0                                                           | The repository and CI select Node.js 24.18.0; local results obtained on 24.14.0 are not equivalent to that CI lane.    |
| Local pnpm                 | 11.9.0                                                            | The repository pins pnpm 11.15.1 through `packageManager`.                                                             |
| Local .NET SDK             | Workspace-local 8.0.423 (runtime 8.0.29), under ignored `work/`   | Portable tests and Windows cross-target compilation/publish run on macOS; Windows runtime and printer behavior do not. |
| Vercel CLI/authentication  | Authenticated owner; linked `club-paradiso/paradiso-print-cess`   | Project root is `apps/web`; a provider-backed dedicated Preview exists, while automatic Git builds remain disabled.    |
| Vercel/Upstash credentials | Vercel OIDC context only; no approved Blob store/Redis/QStash set | Local adapters remain the executable baseline; the manual Preview provider gate cannot run yet.                        |
| Physical printer           | Not attached to this macOS environment                            | A GitHub Windows runner proves compilation and mock behavior, not driver, spooler, paper, or physical output behavior. |

## Architectural decisions

1. A versioned protocol package is the normative TypeScript contract. C# uses the same constants,
   state names, envelope layout, and synthetic interoperability vector.
2. The kiosk creates a session-specific P-256 ECDH key pair. Its private key never leaves kiosk
   process memory. The QR fragment contains the upload bearer token and public-key fingerprint.
3. The phone verifies that fingerprint, encrypts locally with ECDH P-256, HKDF-SHA-256, and
   AES-256-GCM, then uploads only the binary ciphertext envelope.
4. Route Handlers carry small JSON requests only. They never proxy a document or ciphertext.
5. `SessionStore`, `BlobTransport`, and `CleanupScheduler` separate local development from Upstash,
   Vercel Blob, and QStash.
6. Claim, upload registration, consume, and terminal sealing require an atomic Redis Lua operation
   or an equivalent revision compare-and-set. Consume-once is the print idempotency boundary.
7. Blob pathnames are cryptographically random and contain no original filename. Each
   `@vercel/blob` 2.6.1 delegation is restricted to that one pathname, exactly one operation, and a
   short expiry.
8. Production cleanup is a saga: seal the session, conditionally delete the Blob by ETag, then
   delete the Redis record. QStash, explicit terminal cleanup, Redis TTL, and an orphan sweep are
   independent backstops. The adapters implement terminal sealing, persistent pathname/ETag orphan
   records, a due-time sorted set, and a bounded sweep; approved Upstash/Blob/QStash contention and
   outage tests remain a Production gate.
9. The kiosk decrypts in memory, validates again, and submits once to the configured printer. An
   ambiguous spool submission is never automatically retried.
10. The public browser kiosk is independently gated from demo and administrator routes. Demo routes
    default off in Production. Metrics default off everywhere and, if approved, contain only
    short-lived aggregates without persistent session identifiers.
11. Production server configuration rejects local adapters, non-exact/non-HTTPS origins, missing
    provider credentials, and undersized registration/administrator/provider secrets. The kiosk
    allows mock printing only in explicit loopback Development mode and accepts encrypted Blob
    downloads only from an exact deployment-controlled host allow-list.

The detailed component and failure model is in `docs/ARCHITECTURE.md`. The normative envelope is in
`docs/CRYPTOGRAPHY.md`.

## Implementation sequence

1. Establish the Paradiso name, pnpm workspace, strict TypeScript, formatting, lint, and CI scripts.
2. Freeze protocol version 1, the session state machine, token rules, binary envelope, and
   cross-language test vector.
3. Implement local memory/session, encrypted-blob, and in-process cleanup adapters.
4. Implement Redis atomic transitions, Vercel Blob scoped signed URLs, QStash verification, and
   orphan tracking behind the same interfaces.
5. Implement the mobile flow, public browser kiosk, development-only administrator simulator,
   internationalization and accessibility.
6. Implement kiosk Core, Infrastructure, WPF UI, validation, mock print engine, Windows print
   engine, session reset, and crash recovery.
7. Generate only synthetic fixtures and cover units, API integration, browser E2E, cryptographic
   interoperability, Windows build/test/publish, and manual printer acceptance.
8. Run an adversarial review, resolve fixable findings, then use a Draft PR and required checks.
   The user authorized safe PR merges for online delivery; merging does not authorize a GitHub
   Release or Vercel Production deployment.

## Verification strategy

| Layer                                             | Where                                            | Evidence                                                                                    |
| ------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Format, lint, typecheck, unit, integration, build | Node.js 24.18.0 on GitHub Ubuntu runner          | Exit status plus coverage and credential-free report artifacts                              |
| Browser E2E and accessibility smoke tests         | Playwright Chromium in local-adapter mode        | HTML/assertion report only; automated trace and screenshot capture disabled                 |
| Platform-independent kiosk core                   | macOS and `windows-latest`                       | Local result plus synthetic-only Windows TRX artifact                                       |
| WPF and Windows-targeted infrastructure           | GitHub `windows-latest`                          | Restore, Release build, tests, and self-contained `win-x64` publish                         |
| TypeScript/C# crypto                              | Both test suites using identical immutable bytes | Exact envelope bytes and negative tamper/AAD/version cases                                  |
| Vercel Blob, Redis, QStash                        | Approved Preview resources only                  | Credential-gated integration results; no real documents                                     |
| Printer/driver/spooler/kiosk lockdown             | Physical target Windows device                   | Signed manual acceptance record by printer model, driver, Windows build, and policy version |

A local cross-target build and a green hosted Windows run are not physical-printer evidence. This
macOS host cannot establish WPF runtime correctness.

## Official documentation and registry checks

- The npm registry reported `@vercel/blob` 2.6.1, Apache-2.0, Node.js 20 or newer. Its published
  declarations expose `issueSignedToken` and `presignUrl` with one pathname, `put`/`get`/`head`/
  `delete` operations, absolute `validUntil`, PUT content-type and maximum-size constraints, and
  conditional delete by ETag. Vercel's
  [signed URL announcement](https://vercel.com/changelog/signed-urls-are-now-available-for-vercel-blob)
  confirms the pathname, operation, and expiry scope.
- Microsoft documents WPF's `PrintQueue`, `PrintCapabilities`, `PrintTicket`, and
  `XpsDocumentWriter` in its
  [WPF printing overview](https://learn.microsoft.com/en-us/dotnet/desktop/wpf/documents/printing-overview).
  Printer-driver behavior still requires target-hardware testing.
- Microsoft's
  [Shell Launcher documentation](https://learn.microsoft.com/en-us/windows/configuration/shell-launcher/)
  says it supports desktop applications on Enterprise, Education, and IoT Enterprise editions and
  does not by itself prevent access to every other component. AppLocker/GPO and device controls are
  therefore part of the deployment baseline.
- Microsoft's
  [.NET lifecycle](https://learn.microsoft.com/en-us/lifecycle/products/microsoft-net-and-net-core)
  lists .NET 8 LTS end of support as 2026-11-10. A supported-target migration is a production
  blocker if service continues beyond that date.

## Known uncertainties

- The WPF shell now composes live session registration/polling, local QR rendering, consume/direct
  download, decrypt, validate, print-once, terminal reporting/cleanup, and reset. That composition
  has only portable/unit and macOS cross-target evidence; live Windows, server/provider, and
  physical-printer behavior remains unverified. The authenticated screen now provides allow-listed
  installed-printer selection with a persisted choice, printer status, a synthetic test print,
  recovery acknowledgement, active-session discard, app restart, audio test, explicit
  server/Redis/Blob/QStash status, and a bounded authenticated orphan sweep. Server and Redis
  status are live checks; external Blob/QStash status remains honestly `configured-unverified`
  because their providers expose no side-effect-free probe through this contract.
- No approved Vercel, Blob, Redis, or QStash credentials were available, so signed URL enforcement,
  provider CORS, provider logging, region, expiry under clock skew, and cleanup delivery have not
  been observed against Preview. The current Production startup gate requires exact HTTPS origins,
  32-character kiosk/administrator secrets, and 20-character-or-longer Blob/Redis/QStash secrets;
  this fail-closed validation does not replace credential-backed testing or secret-store approval.
- Exact Production Blob download hostname(s) are not known. They must be captured from the approved
  environment and provisioned through `PRINT_CESS_ALLOWED_BLOB_HOSTS`; wildcards and a permissive
  fallback are not accepted.
- The target Windows edition, printer model, driver version, spool format, and spool retention
  policy are not yet known.
- PDF/image parsing and rendering libraries require final license, maintenance, exploit-resistance,
  and representative-driver review.
- All non-English copy requires device testing and native-speaker review.
- Code signing, installer format, and update trust chain require institutional configuration. The
  `windows-signing` environment exists with a `v*` tag-ref restriction, and the workflow requires
  the input tag, workflow ref, commit, and protected-main ancestry to agree. The signed candidate
  is additionally bound to the tag/commit version, exact approved certificate thumbprint,
  timestamp certificate, and hashed manifest that the target collector re-verifies. No approved
  certificate, publisher/timestamp configuration, or independent environment reviewer exists.
- `main` now requires strict PRs, current Web/Windows/dependency/Gitleaks checks, conversation
  resolution, linear history, and admin enforcement. GitHub environments restrict Preview to
  `main`, Production to `main`, and signing/Release to `v*` tags. Active ruleset `19197379`
  restricts creation, update, and deletion of matching release tags to the repository owner
  bypass; independent review and migration to an institutional release role remain open. GitHub
  native secret scanning returned 422 and CodeQL setup returned 403 for this private personal
  repository; keep `ENABLE_CODEQL` unset until the repository has the required security entitlement
  and a successful validation run.
- Provider deletion semantics, backups, and infrastructure access-log retention require contractual
  review; application deletion cannot prove immediate physical erasure in provider backups.

These items are expanded in `docs/PRODUCTION_BLOCKERS.md` and `docs/REMAINING_RISKS.md`.
