# Print quota policy

Print-cess uses two deliberately separate page limits.

| Range       | Public web flow                                 | Kiosk authority                                       |
| ----------- | ----------------------------------------------- | ----------------------------------------------------- |
| 1–11 pages  | Allowed                                         | Allowed after native validation                       |
| 12–50 pages | Shows the deliberately fake Print-cess+ paywall | Requires a staff password after native rendering      |
| 51+ pages   | Hard-limit explanation; no plan is offered      | Always rejected, including after staff authentication |

The public courtesy limit is 11 pages. The technical ceiling is 50 pages. Raising one must never silently raise the other.

## Thirty-file batch selection

- A print batch can contain up to **30 files**, including JPEG/PNG photos, PDFs, and supported HWP/HWPX files, in any order or mixture. Both the browser and native kiosk parser enforce this hard count.
- The authenticated bundle stays within **32 MiB in total**, including its per-file headers. A single document still has its existing size limit. Mobile image normalization can reduce photos locally to fit the remaining budget after documents are accounted for; documents are not silently compressed or modified.
- Selecting 30 files does not increase the free print allowance of **11 pages**. Jobs with 12–50 known pages can reach the existing Windows-kiosk staff approval step. An unstaffed browser kiosk cannot bypass the quota, and staff cannot authorize more than 50 pages.
- HWP/HWPX pagination is provisional on mobile and is verified after the native kiosk renders it. Malformed, oversized, unsupported, or over-quota batches must be rejected before the spooler receives them.
- The source files remain local until the visitor expressly initiates the encrypted transfer, and the original document ordering is preserved.

## Counting

- PDFs use their parsed page count.
- JPEG and PNG images contribute one page each.
- A multi-file job is judged by the sum of every selected document.
- HWP and HWPX pagination is not claimed as exact on the phone. Hancom determines the real count while the Windows kiosk renders the document.

The browser decision improves the visitor experience, but it is not trusted. The Windows print engine repeats the decision using the number of rendered pages immediately before the spooler submission. A browser value or modified client cannot grant an override.

## Staff override

For a rendered job of 12–50 pages, the kiosk opens a dedicated staff prompt. It uses the same externally configured, throttled administrator authenticator as the diagnostics flow. The password is cleared after the attempt and is never logged.

The fake paywall never starts checkout, loads a payment provider, or accepts payment details. Its action ends by explaining that there is no product to buy and directs the visitor to choose 11 pages or fewer. Staff authorization happens only at the kiosk.

## Safe operational record

Quota telemetry may record the total, decision, limit values, whether pagination was verified, and whether a staff override was used. It must not contain filenames, document content, passwords, or session secrets.
