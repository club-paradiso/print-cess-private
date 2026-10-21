<p align="center">
  <img src="docs/assets/print-cess-mark.svg" alt="Print-cess by Club Paradiso mark" width="96" />
</p>

# Print-cess by Club Paradiso

**Secure self-service document printing and file hand-off**

휴대전화에서 보내고 바로 출력하는 안전한 셀프 인쇄. 파일과 사진은 휴대전화끼리 바로 주고받아요.

This private repository contains the mobile transfer service, public browser kiosk, shared
protocol, and Windows kiosk for a no-login, one-document, one-copy print flow. It also carries a
phone-to-phone file hand-off at `/send` and `/receive`: end-to-end encrypted, chunked for large
files, format blind, and needing no kiosk. Managed government and public-sector workstations can
start from `/workstation`, which adds browser readiness checks and a policy-aware desktop entry
without installing software or attempting to bypass endpoint controls. See `docs/FILE_TRANSFER.md`
for how it moves bytes, `docs/FILE_COMPATIBILITY.md` for what it will carry, what it does to a file
name, and where a received file actually ends up, and `docs/GOVERNMENT_WORKSTATION.md` for the
managed workstation security boundary. `docs/PRODUCT_V2.md` describes the product model the public
screens follow (Print, Share, Scan, with workplace entrances secondary) and the future native
share-sheet path, and `docs/PRINT_FIRST_ENTRY.md` explains why Print leads the home page and how
a visitor finds the Print-cess screen. `docs/DOCUMENT_JOURNEY.md` is the design record for what the screens say. Development uses encrypted local adapters; production integrations require
separately approved Vercel and Upstash resources.

The complete setup, security boundaries, test commands, macOS browser-kiosk procedure, Windows
deployment procedure, and remaining production blockers are documented in `docs/`. Never use real
personal documents in development, Preview, fixtures, or CI.

## Government and public-sector printing

Print-cess is specialized for no-install document printing and file hand-off at
government counters, including immigration offices:

- **Visitor print mode** at `/visitor`: a counter screen shows a QR code, the
  print progress (scan → upload → counter print → auto-destroy), and a session
  expiry timer. Visitors scan the QR with their own phone and upload documents —
  no login, app install, or sign-up.
- **Automatic file destruction**: uploaded documents are deleted from the server
  as soon as printing finishes or the session expires. Phone-to-phone transfers
  carry an expiry (30 minutes by default, configurable via `DROP_TTL_SECONDS`)
  and are swept automatically when it elapses.
- **No policy bypass**: Print-cess uses standard browser HTTPS and Web Crypto
  and never attempts to bypass DLP, download controls, proxies, network
  separation, or domain allowlists. Managed workstations keep using
  `/workstation`.

See `docs/government-deployment-guide.md` for the agency onboarding procedure
(the six production gates as a checklist) and
`docs/immigration-office-scenario.md` for the immigration-office visitor
document printing scenario.

## Required tools

- Node.js 24.18.0 and pnpm 11.15.1 through Corepack;
- Git and GitHub CLI for the review workflow;
- .NET SDK 8 on Windows for WPF runtime validation and publishing;
- Playwright Chromium/WebKit binaries for end-to-end tests.

## Quick start

```bash
corepack enable
pnpm install --frozen-lockfile
cp .env.example apps/web/.env.local
pnpm dev
```

Open `http://localhost:3000/kiosk`, scan the generated QR with a phone on the same reachable
development URL, or open its mobile link in another browser tab. Local mode stores ciphertext
only under an application-owned development directory. Open `http://localhost:3000/workstation`
to exercise the managed-workstation entry and local browser capability diagnostics.

For unattended Production printing on a Mac, configure an explicit default printer and follow
`docs/MACOS_BROWSER_KIOSK.md`. The checked-in LaunchAgent opens the live URL with Chrome's kiosk and
silent-printing switches in a dedicated browser profile.

The checked-in environment example is for local development. Hosted Preview/Production fails
closed unless exact HTTPS origins and the required Blob, Redis, QStash, kiosk-registration, and
administrator credentials are supplied. The Windows mock printer is available only with
`PRINT_CESS_ENVIRONMENT=Development` and a loopback server; it cannot be enabled for a Production
installation. See `docs/VERCEL_DEPLOYMENT.md` and `docs/WINDOWS_KIOSK_DEPLOYMENT.md` before changing
those defaults.

## Repository

```text
apps/web       Next.js public browser kiosk, mobile flow, file hand-off, and Route Handlers
apps/kiosk     .NET 8 WPF kiosk, core, infrastructure, and tests
packages       protocol, cryptography, translations, UI, and fixtures
docs           architecture, security, privacy, deployment, and operations
```

## Validation

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
pnpm test:e2e
```

Windows-only validation runs in GitHub Actions. A physical printer test is required before any
real deployment; a green CI build is not evidence that a printer model or driver is operational.
Credential-backed provider tests are intentionally separate and require the protected manual
`Preview provider acceptance` workflow.

## Review, Preview, and Windows commands

Keep implementation work on a short-lived branch, push it, and open a Draft PR to protected
`main`. A merge is an integration event, not Production approval:

```bash
git push -u origin agent/production-readiness
gh pr create --draft --base main --head agent/production-readiness
gh pr checks --watch
```

Only after approved Preview credentials and isolated provider resources exist:

```bash
pnpm dlx vercel@56.3.2 link --project paradiso-print-cess
pnpm dlx vercel@56.3.2 env pull apps/web/.env.local --environment=preview
pnpm dlx vercel@56.3.2
```

On Windows PowerShell:

```powershell
dotnet restore apps/kiosk/Paradiso.PrintCess.sln --locked-mode
dotnet build apps/kiosk/Paradiso.PrintCess.sln -c Release --no-restore
dotnet test apps/kiosk/Paradiso.PrintCess.Tests/Paradiso.PrintCess.Tests.csproj -c Release --no-build
dotnet publish apps/kiosk/Paradiso.PrintCess.Kiosk/Paradiso.PrintCess.Kiosk.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true
```

Full procedures and evidence boundaries are in `docs/GITHUB_WORKFLOW.md`,
`docs/VERCEL_DEPLOYMENT.md`, `docs/AUTHENTICODE.md`, and
`docs/WINDOWS_PRINTER_ACCEPTANCE.md`. The final private release dossier contract is in
`docs/READINESS_EVIDENCE.md`.
