# GitHub workflow

## Repository and branch strategy

The repository is `club-paradiso/print-cess`. `main` is the releasable integration
branch. Implementation occurs on short-lived branches such as `feature/initial-implementation` and
enters `main` only through a pull request.

Use Conventional Commits:

- `feat(scope): ...` for behavior;
- `fix(scope): ...` for defects;
- `test(scope): ...` for test-only work;
- `docs(scope): ...` for documentation;
- `chore(scope): ...` for tooling/dependencies.

Initial implementation PR #1 was marked ready and squash-merged on 2026-07-20 only after its
applicable required checks passed and the user explicitly authorized autonomous PR merge. That
merge established the development baseline; it did not authorize Production deployment, a stable
Release, or institutional use. Continue to open Production-readiness changes as Draft PRs and merge
only when the change's required checks and review evidence are accurate.

## Required review

`CODEOWNERS` assigns the repository owner globally and calls out protocol, cryptography, API,
kiosk infrastructure, security documentation, and workflows. Security-critical changes need an
explicit owner review even if generated code or dependency automation created the PR.

PRs must:

- use only synthetic fixtures and sanitized screenshots;
- state whether protocol, crypto, privacy, cleanup, printing, or provider configuration changed;
- distinguish macOS/local, hosted Windows, Preview, and physical-printer evidence;
- include a migration/version decision for protocol-breaking work;
- confirm that no Production deployment, Release, or `main` merge occurred unless separately
  authorized.

## Actions

### `ci.yml`

On pull requests and pushes to `main`:

- **Web** on Ubuntu with Node.js 24.18.0 and pnpm 11.15.1: frozen install, format check, lint,
  typecheck, unit tests, workflow and external-readiness evidence policy tests, integration tests,
  production build, Playwright Chromium E2E, and safe report/coverage artifact upload. Automated
  Playwright screenshots and traces are disabled because QR images and network bodies can contain
  short-lived credentials.
- **Windows kiosk** on `windows-latest` with .NET 8: restore, Release build, xUnit/TRX tests, a
  self-contained `win-x64` publish smoke test whose single-file executable is then asserted to
  exist, signing/acceptance evidence-contract tests, a synthetic-only TRX artifact, and the smoke
  binary.

The Web workflow uploads only coverage and the HTML Playwright report for three days; raw
`test-results`, screenshots, and traces are excluded. Windows TRX and publish-smoke artifacts are
retained for seven days, which `PRODUCTION_BLOCKERS.md` requires and which storage pressure is not a
reason to shorten.

Retention windows say how long evidence lives; they do not say how many copies are worth keeping.
Web evidence and the publish-smoke binary are uploaded on `main` pushes and, for the Web job, on any
failure — a green pull-request run is the most common run and the one nobody opens, and the
self-contained kiosk binary alone is roughly 180 MB against an account-wide 500 MB free tier. Every
check still runs on every pull request, including the assertion that the single-file executable
exists; only the stored copy is skipped. The TRX is small and is uploaded always, pass or fail.

Artifact names contain only run identifiers. If a failure output includes a URL,
token, fragment, filename, document data, or provider body, cancel sharing, delete the artifact,
rotate any affected credential, and treat the run as a security/privacy incident.

Every artifact upload is `continue-on-error`, and the Gitleaks SARIF upload is disabled outright
because that step is inside the action and has no such seam. Uploads preserve evidence; they are not
the verdict, which is always the exit code of the step that produced the result. A full account
Actions storage quota once reported a clean secret scan, a clean dependency audit, and a passing
26-test end-to-end run as three failed checks, and no change to this repository could have made
those checks pass. A failed upload still shows in the job, so the loss of evidence stays visible.
Do not extend `continue-on-error` to a step that decides something, and do not buy quota headroom by
shortening a retention window that an acceptance criterion names — free the storage instead.

External service credentials are not supplied. Tests run in local/mock mode. A successful Windows
job proves WPF compilation and test behavior on a hosted VM; it does not prove the real printer,
driver, spool retention, kiosk lockdown, touch/audio, or physical output.

### `security.yml`

Runs on relevant pushes/PRs, manual dispatch, and weekly schedule:

- CodeQL JavaScript/TypeScript analysis on Ubuntu when repository variable `ENABLE_CODEQL=true`;
- CodeQL C# analysis with a manual WPF build on Windows under the same gate;
- production pnpm audit and NuGet transitive-vulnerability report;
- full-history Gitleaks helper scan.

The GitHub API reported on 2026-07-20 that code scanning is not enabled for this private
repository, so both CodeQL jobs are explicitly skipped until an administrator enables the feature
and sets `ENABLE_CODEQL=true`. Do not set that variable merely to make the jobs appear active;
first confirm licensing and a successful manual run. The Gitleaks helper complements, but does not
enable, GitHub native secret scanning or push protection. Gitleaks Action licensing must be checked
if ownership moves from a personal account to an organization.

### `release-kiosk.yml`

This is manual-only and tag-based. The operator must dispatch the workflow from the exact existing
`vX.Y.Z` stable tag or `vX.Y.Z-rc.N` prerelease tag supplied as the input. The workflow rejects a
branch dispatch, a ref/input mismatch, a tag whose commit differs from the workflow ref, or a tag
whose commit is not reachable from protected `main`. It restores, builds, tests, publishes
self-contained `win-x64` whose product version is bound to the tag and commit, and uploads a one-day
unsigned handoff. A separate protected `windows-signing` job signs `Print-cess Kiosk.exe`, runs
`signtool verify /pa /all /tw /v`, checks the exact approved publisher subject and certificate
thumbprint, requires a timestamp certificate, removes PDBs, and creates the signed ZIP, checksums,
and structured Authenticode manifest. No unsigned artifact can reach the GitHub Release job. See
`AUTHENTICODE.md`.

The separate GitHub Release job runs only when the operator explicitly sets `publish_release`, an
administrator has set repository variable `ENABLE_GITHUB_RELEASES=true`, and the job passes the
protected `github-release` environment. Stable and prerelease inputs are validated against tag
syntax. Keep the variable absent until the environment is configured; otherwise GitHub can create
a referenced environment without the intended protection. The workflow exists for future
authorized use; it was not run and no GitHub Release is published by this task.

## Branch protection / ruleset

On 2026-07-20 the `main` branch protection API was configured to require pull requests, strict
up-to-date branches, conversation resolution, linear history, and checks `Web`, `Windows kiosk`,
`Dependency audit`, and `Secret scan helper`. It dismisses stale reviews, enforces the policy for
administrators, and blocks force-push and deletion. Repository merge settings allow squash only,
delete merged branches, allow update-branch, and enable auto-merge capability.

The repository is currently a single-maintainer private personal repository, so required approvals
and CODEOWNER reviews are set to zero rather than creating an impossible self-approval gate. This
is not adequate institutional separation of duties. Active repository ruleset `19197379` protects
`refs/tags/v*` from creation, update, and deletion by every actor except the repository owner's
bypass. That preserves current solo release administration, but it is not independent approval.
Before Production, move or staff the repository so at least one independent approval and CODEOWNER
review can be required, migrate the release-tag bypass to an approved institutional release role,
decide signed-commit policy, and capture the resulting ruleset evidence.

## Protected environments

The following environments were created on 2026-07-20. GitHub custom deployment policies now
restrict `vercel-preview` to the `main` branch and both `windows-signing` and `github-release` to
tags matching `v*`. GitHub evaluates those rules against the workflow run's `GITHUB_REF`, so the
release workflow also binds its tag input to the exact tag ref in code. Current policies are:

- `github-release`: `v*` tags only; still needs an independent institutional reviewer before
  `ENABLE_GITHUB_RELEASES=true`;
- `windows-signing`: `v*` tags only; still needs an independent reviewer, approved PFX or
  managed-signing custody, and publisher/timestamp variables;
- `vercel-preview`: `main` only; still needs approved Preview-only credentials/resources and an
  independent reviewer;
- `Production`: `main` only; Vercel Production deployment remains disabled and this environment
  still needs multiple required reviewers and approved Production credentials.

Required-reviewer protection is unavailable for this private personal repository's current plan,
and no environment contains secrets or release-enabling variables. The ref restrictions therefore
reduce accidental execution but do not provide institutional separation of duties.

Vercel also created a generic `Preview` deployment-record environment with no protection rules.
It is not an authorized provider-acceptance gate: the controlled workflow uses `vercel-preview`,
and automatic Vercel Git deployment remains disabled.

Never expose credentials to untrusted fork pull requests. Workflows use least-privilege
`permissions` and grant `contents: write` only to the explicit Release job.

## Secret management

No real secret belongs in Git, fixtures, workflow YAML, artifacts, PR text, or screenshots. Store
GitHub Release signing credentials and Vercel/Upstash values in their protected environment or
provider secret store. Rotate any value that reaches logs or history.

GitHub returned HTTP 422 for native secret scanning/push protection and HTTP 403 for CodeQL default
setup on this private personal repository. The current account/repository does not have the required
GitHub security feature entitlement. Keep Gitleaks and dependency checks required, keep
`ENABLE_CODEQL` unset, and upgrade or move the repository before treating native secret or code
scanning as present.

Required Production secret inventory and owners must include Blob/OIDC, Redis, QStash current/next
keys, kiosk registration, administrator authentication, code-signing certificate access, and
deployment credentials. Release artifacts must not contain `.env` files.

## Dependency updates

Dependabot checks npm/pnpm, NuGet, and GitHub Actions weekly. Review lockfile changes, release notes,
licenses, provenance, parser/renderer attack surface, and test evidence. Do not auto-merge
cryptography, document parsing, printing, or workflow changes.

## Version and release policy

Use SemVer while the product is pre-1.0. A protocol-incompatible change requires a new explicit
protocol version and cannot silently reuse active sessions. Tag examples:

- `v0.2.0-rc.1`: prerelease for controlled Windows acceptance;
- `v0.2.0`: approved stable artifact.

Publishing a stable tag is not deployment approval. Before any Release, require Windows CI, exact
printer/driver acceptance, Authenticode signing, checksum verification, security/privacy approval,
and rollback evidence. Before any Production web deployment, close `PRODUCTION_BLOCKERS.md`.

The final external records must also pass the release-bound dossier policy in
`READINESS_EVIDENCE.md`. CI tests only the policy implementation with synthetic data; it never treats
those fixtures as operational approval.
