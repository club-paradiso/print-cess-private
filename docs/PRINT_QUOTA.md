# Print quota policy

Print-cess uses two deliberately separate page limits.

| Range       | Public web flow                                 | Kiosk authority                                       |
| ----------- | ----------------------------------------------- | ----------------------------------------------------- |
| 1–11 pages  | Allowed                                         | Allowed after native validation                       |
| 12–50 pages | Shows the deliberately fake Print-cess+ paywall | Requires a staff password after native rendering      |
| 51+ pages   | Hard-limit explanation; no plan is offered      | Always rejected, including after staff authentication |

The public courtesy limit is 11 pages. The technical ceiling is 50 pages. Raising one must never silently raise the other.

## Thirty-photo batch selection

- A **photo-only** selection may contain up to **30 images** in one encrypted print bundle. Any selection including PDFs, HWP or HWPX remains limited to **10 files**. The native bundle parser enforces this distinction again after decryption.
- The total encrypted payload budget stays at **32 MiB**. The phone can rescale and JPEG-compress oversized images locally to fit a per-photo budget; the original files stay on the phone. A batch that cannot meet the budget is rejected before upload.
- **Selecting 30 photos does not raise the public free-page allowance.** At 12–30 pages the phone explains that staff approval will be required, then sends the batch for the existing kiosk-side approval flow. The native renderer verifies the real page count and obtains staff authorization before submitting the entire job.
- The system ceiling of 50 pages and the original PDF/Hancom rules stay unchanged. No client-provided quota override is trusted.

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
