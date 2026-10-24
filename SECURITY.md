# Security policy

Print-cess handles other people's documents, so we take reports seriously and answer them quickly.

## Reporting a vulnerability

Please do not open a public issue, discussion or pull request for a security problem.

Report it privately through GitHub instead: **Security → Advisories → Report a vulnerability** on
this repository. Include:

- the commit or deployment you tested;
- what an attacker can do, and what they need first;
- steps to reproduce, using made-up documents and test accounts only.

Never attach a real identity, travel or immigration document, a live credential, a transfer code or
a signed URL. If you find an exposed credential, say so in the report and we will revoke it before
anything else.

## What to expect

- Acknowledgement within three business days.
- A first assessment and next step within seven business days.
- Credit in the advisory once a fix ships, if you want it.

Please give us a reasonable time to fix the problem before you disclose it.

## Supported versions

There is no stable release yet. Fixes go to the latest commit on `main` only.

## Scope

In scope: the web app and API in `apps/web`, the cleanup worker, the Windows kiosk in `apps/kiosk`,
the shared `packages`, and the CI workflows.

Out of scope: denial of service by volume alone, reports that need a compromised device or
operator account, and findings in third-party services (Vercel, Upstash, Railway) that are not
caused by how Print-cess uses them.

The design behind these guarantees, including the threat model and cryptography, is in
[`docs/SECURITY.md`](docs/SECURITY.md), [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) and
[`docs/CRYPTOGRAPHY.md`](docs/CRYPTOGRAPHY.md).
