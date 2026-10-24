# Production blockers

Status: **Production is prohibited.** The Vercel project is linked but automatic deployments are
disabled. A provider-backed dedicated Preview exists, but no approved Production kiosk deployment,
stable GitHub Release, signed kiosk artifact, physical site installation, or institutional approval
exists.

Every item below needs an accountable owner, dated evidence, and formal acceptance. A checked-in
configuration file or green mock test does not close an institutional gate.

The final sanitized private export must pass the completeness policy in `READINESS_EVIDENCE.md`.
Current automated tests prove the validator, not the absent provider, hardware, reviewer, native
GitHub-control, or institutional records; therefore they do not close any checkbox below.

## Governance and privacy

- [ ] **Institutional information-security approval.** Approve architecture, threat model,
      internet/provider use, endpoint hardening, incident response, and residual risks.
- [ ] **Privacy/legal review.** Determine controller/processor roles, Korean privacy-law basis and
      notice, cross-border transfer requirements, subject inquiries, incident handling, and physical
      output disposal.
- [ ] **Vercel and Upstash approval.** Approve Vercel web/Private Blob and Upstash Redis/QStash,
      contracts/DPA, subprocessors, support access, availability, and exit plan.
- [ ] **Data location/log/backup retention.** Document regions and retention for request logs,
      access logs, QStash delivery, Redis, Blob deletion/backups, support access, and security
      telemetry. Application deletion cannot prove immediate provider-backup erasure.
- [ ] **Brand/trademark/site-language review.** Approve Print-cess by Paradiso naming and confirm no
      confusion with Printess or an official government service.

## Provider and application security

- [ ] **Production resources and credentials.** Vercel project access exists, but no approved Blob,
      Redis, QStash, registration, administrator, release, or signing credentials were available.
      Provision separate
      Preview/Production resources and rotation owners. Evidence the fail-closed startup contract:
      exact HTTPS origins, 32-character-or-longer registration/diagnostics secrets, HTTPS Redis,
      and 20-character-or-longer Blob/Redis/QStash values. The current build requires
      `BLOB_READ_WRITE_TOKEN`; OIDC-only operation is not implemented.
- [ ] **Credential-backed signed URL tests.** Against `@vercel/blob` 2.6.1, prove exact-path,
      one-operation PUT/GET/DELETE, short expiry/clock skew, content type, 10,485,911-byte maximum,
      no-overwrite, ETag comparison, conditional delete, replay, and redaction.
      The manual `Preview provider acceptance` workflow and provider-only Vitest suite are ready but
      have not run because approved credentials/resources are absent.
- [ ] **Redis atomicity under contention.** Prove Lua/CAS first-claim, upload-once, consume-once,
      terminal immutability, cleanup/consume race, and TTL behavior against approved Upstash Redis.
- [ ] **QStash delivery and recovery.** Prove current/next signature verification, delayed schedule,
      deterministic deduplication, failed/lost schedule acknowledgement replay, already-deleted
      behavior, provider outage, and bounded orphan sweep.
- [ ] **Origin/WAF/firewall policy.** Finalize the approved domain, exact CORS origins, rate limits,
      function/body/time limits, egress hostnames, denial-of-service thresholds, and monitoring.
      Capture the exact Production Private Blob download hostname(s) for the kiosk allow-list;
      wildcards, Preview hosts, signed-URL user information, and server-supplied GET headers are not
      permitted.
- [ ] **Repository controls.** `main` now requires strict PRs, conversation resolution, linear
      history, admin enforcement, and Web/Windows/dependency/Gitleaks checks, and blocks force-push
      and deletion. `vercel-preview` is `main`-only; `windows-signing` and `github-release` are
      `v*`-tag-only, and release inputs are bound to the workflow tag ref and protected-main
      ancestry. `Production` is also `main`-only, while Vercel Production deployment remains
      disabled. Active ruleset `19197379` restricts creation, update, and deletion of `v*` tags to
      the repository owner's bypass. Remaining: independent/CODEOWNER and environment
      reviewers, migration of that bypass to an institutional release role, signed-commit decision,
      native secret scanning and push protection, and CodeQL. GitHub returned 422/403 because native
      secret/code scanning is unavailable for this private personal repository; upgrade/move it
      before setting `ENABLE_CODEQL=true`.
- [ ] **CI evidence privacy.** Verify that Playwright screenshots/traces and raw `test-results` stay
      disabled/excluded, only synthetic fixtures are used, Web evidence expires after three days,
      Windows TRX/publish-smoke evidence expires after seven days, and incident deletion/rotation is
      exercised for an artifact containing a credential or personal data.
- [ ] **Supply-chain approval.** Review npm/NuGet/Actions licenses and provenance, particularly
      document parser/renderer and native printing dependencies; decide immutable Action pinning.

## Windows and printing

- [ ] **Administrator controls acceptance.** The authenticated screen implements exact allow-listed
      installed-printer selection/persistence, printer status, a synthetic test print, recovery
      acknowledgement, active-session discard, app restart, redacted observations, explicit
      server/Redis/Blob/QStash status, a capped 25-record orphan sweep, and audio testing. Validate
      those controls on the target Windows account and approved resources. Server/Redis checks are
      live; external Blob/QStash status is only `configured-unverified`, so exercise real encrypted
      Blob and delayed-cleanup operations plus provider-outage recovery before approval.
- [ ] **Target hardware and Windows baseline.** Record desktop model, x64 capability, Windows
      edition/build/servicing date, TPM/BitLocker/endpoint management, account model, and installation
      permission.
- [ ] **Kiosk lockdown.** Confirm an edition supporting the chosen Shell Launcher/restricted-user
      model; test AppLocker/WDAC, GPO/MDM, keyboard escape, removable media, dialogs, task switching,
      admin access, firewall, crash dumps, page file, and update behavior.
- [ ] **.NET lifecycle migration.** The required implementation targets .NET 8, whose Microsoft end
      of support is **2026-11-10**. Select, implement, and retest a supported target before that date.
      Self-contained publish does not make unsupported runtime bits safe.
- [ ] **Signed installer/update chain.** The workflow now requires a protected Authenticode
      sign/verify job before creating a Release candidate. It fail-closes on the exact approved
      certificate thumbprint, timestamp presence, tag/commit-bound executable version, and emits a
      hashed evidence manifest for target-device comparison. Obtain an approved certificate,
      configure reviewed `windows-signing`, choose installer/update distribution, timestamp and
      malware-scan builds, verify the manifest chain on target Windows, and prove rollback.
- [ ] **Exact printer/driver validation.** Printer model, firmware, connection, driver, queue name,
      A4/simplex/mono/fit/one-copy capabilities, status mapping, and XPS/GDI/render path are unknown and
      untested on physical hardware.
- [ ] **Duplicate/ambiguous-job fault tests.** Inject offline, paper-out, paused, jam, disconnect,
      spooler restart, driver crash, app crash, reboot, and power loss at each submit boundary. Prove no
      automatic retry when submission is uncertain.
- [ ] **Spooler/driver/printer retention.** Approve spool-file deletion/job history, crash dump/page
      file, driver cache, printer disk/firmware retention, and secure disposal/maintenance.
- [ ] **Kiosk recovery-journal policy.** The durable journal contains a SHA-256 session-ID hash,
      state, safe code, and timestamp. Approve and Windows-test its implemented 24-hour pruning for
      completed/rejected/administrator-resolved records and the authenticated P-04 acknowledgement
      path. Unresolved records must never be automatically pruned or replayed.
- [ ] **Physical output control.** Approve kiosk/printer placement, privacy/collection tray,
      completion audio/arrow, abandoned-print response, and accessibility.
- [ ] **"TITLE" warning after a Windows download (reported, not yet reproduced).** A warning
      mentioning TITLE was reported after downloading on Windows. As of 2026-10-12 its exact text is
      not recorded in the repository, issues or pull requests, and no code path sets a document Title
      or `Content-Disposition`. Collect before changing code: a screenshot and the verbatim message;
      Windows edition/build, browser and version; the file name, extension and the page it came from
      (Windows kiosk release ZIP, the kiosk's `파일 다운로드 (직원용)` recovery copy, `/receive`, or a
      `/scan` PDF); which program showed the warning; `Get-Content <file> -Stream Zone.Identifier`;
      `Get-AuthenticodeSignature <file>` for executables; and the PDF's document properties if it is
      a PDF. Do not resolve it by turning off SmartScreen, Mark-of-the-Web or Protected View, or by
      telling visitors to run `Unblock-File`. Fix the cause: signing per `AUTHENTICODE.md`, or the
      file's own metadata and name.

## Content, accessibility, and operations

- [ ] **Native-speaker review.** English, Korean, Simplified Chinese, Indonesian, Filipino,
      Vietnamese, Thai, Nepali, Khmer, Arabic, Russian, Mongolian, and Ukrainian copy is
      placeholders until reviewed for accuracy and safe instruction.
- [ ] **Accessibility and low-literacy acceptance.** Test screen readers, focus/keyboard, contrast,
      reduced motion, touch targets, QR comprehension, and 30-second reminder on
      representative iPhone/Android and kiosk hardware.
- [ ] **Usability KPI trial.** With synthetic documents and approved participants, measure
      scan-to-approval target (60 seconds), staff intervention, errors, stale-screen exposure, and
      duplicate print.
- [ ] **Operations ownership.** Name service, network, printer, Windows, provider, security/privacy,
      and after-hours incident owners; approve P/N/A/S runbook codes and maintenance windows.
- [ ] **Capacity/availability/rollback.** Load-test rate limits and provider quotas, define service
      availability/cleanup-lag alerts and acceptable outage, and exercise web/kiosk rollback.

## Evidence that does not close these blockers

- Local tests using memory/local adapters;
- a Vercel Preview without provider-policy approval;
- GitHub `windows-latest` WPF compilation;
- MockPrintEngine artifacts;
- a checksum without Authenticode signing;
- a successful print to a different printer/driver;
- developer review of machine-translated content;
- Redis TTL without demonstrated Blob deletion.
