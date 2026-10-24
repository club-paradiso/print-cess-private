# Print-cess V2: the product model

Print-cess is the shortest safe path for moving a file from one device, person, or piece of paper
to another device or to paper. Visitors should not need to learn protocols, sender and receiver
roles, sessions, storage, kiosks, or encryption to use it. Those are engineering concerns.

```text
FILE   →  DESTINATION  →  TRANSFER
PAPER  →  DIGITAL FILE →  DESTINATION
```

This document records what V2 changed in the product, what it deliberately left alone, and how a
future native app could build on it. `DOCUMENT_JOURNEY.md` remains the record for what each
screen says, and `PRINT_FIRST_ENTRY.md` for the print-first home page.

---

## Three capabilities, one home

| Capability | What it does                             | Where it starts                                 | Route(s)             |
| ---------- | ---------------------------------------- | ----------------------------------------------- | -------------------- |
| **Print**  | A file on a phone becomes paper          | The QR code on the screen beside the printer    | `/kiosk` → `/s/[id]` |
| **Share**  | A file moves to another device or person | This page: choose files, or open with a code    | `/send`, `/receive`  |
| **Scan**   | Paper becomes a PDF on this phone        | This page: camera or photos, then a destination | `/scan` (→ Share)    |

The home page (`/`) leads with Print and shows Share and Scan beneath it as two smaller sheets.
`PRINT_FIRST_ENTRY.md` records why. Each secondary sheet opens with a route glyph (`RouteGlyph` in
`packages/ui`) that draws where the file goes: phone to laptop, camera to PDF. The Print section
shows the Print-cess Beacon, the same marker the shared display shows, so a visitor can find the
display by matching it.

- **Print leads, and still links nowhere.** Printing needs a kiosk session, and only the kiosk
  can create one. The section shows the Beacon and four steps, and offers two buttons that open
  sheets on the same page: scan the screen's QR code from here, or see how to find the screen.
  Neither goes to a print route, which would be a dead end.
- **Share has one primary action**, choosing files to send, and receiving as a secondary link.
  A visitor who arrives from a scanned transfer QR or a shared link goes straight into receiving
  and never sees a choice between modes.
- **Scan opens the scanner.** The finished PDF can go on through Share, be downloaded, be handed
  to another app where the browser can share that exact file, or be printed through this
  device's own print window, which the button names as such.

### Consumer and institutional entrances

Institutional entrances share the page but rank below Print, Share and Scan. The managed-workstation entry
(`/workstation`) and, where the browser kiosk is enabled, the kiosk display (`/kiosk`) sit below
a hairline under "At work or on a public computer" as plain links. They are not a fourth
capability, and none of their diagnostics or policy wording appears in the consumer flows. The
Production kiosk link is still hidden when the browser kiosk is disabled, so the home never links
to a route that returns 404.

No monetization, donation, or promotional controls exist on any consumer, kiosk, or workstation
screen, and V2 adds none.

---

## Share is one capability

`/send` and `/receive` keep their routes, protocol, encryption, and server contracts unchanged.
The interface changes are:

- Both use one consumer header (`AppTopbar`). The wordmark links home, the language picker sizes
  to the language it shows, and both flows carry the same "Share" label.
- The send step has no step counter. Photos and Files are two equal tiles (`SourcePicker`), and
  on desktop the whole step accepts dropped files. A link to receive with a code sits beneath.
- The ready screen leads with what the receiving side has done, then the QR code, then sharing
  or copying the link, then the optional four-digit hand-off after an "or" divider. Erasing is last.
- The escrow trade-off of the four-digit hand-off (the service holds the key for three minutes)
  is stated at the shape picker, where the visitor makes that choice. The privacy note on the
  pick step now says only what applies to every transfer.

Status semantics are unchanged: waiting, connected, on its way, and taken map to what the
service can actually distinguish, and "Saved", "Download started", and "Sent to another app"
remain three different claims (ADR 0001).

## Print stays fast

The friction budget in `DOCUMENT_JOURNEY.md` is unchanged. The file step shows Photos and Files as
equal tiles because the right source depends on what the visitor holds: a screenshot of a
booking is in Photos, and an emailed PDF is in Files. Neither is styled as the expected answer.

The scanner is deliberately **not** offered inside the print flow. A claimed kiosk session lives
`SESSION_TTL_SECONDS` (180 by default, 300 at most), and a multi-page scan with edge correction
can outlast it and lose the scan. To print paper at a kiosk, scan it with Scan and download the
PDF, then scan the kiosk's QR code and choose the PDF from Files. Rejoining a scan to a kiosk
session without that detour needs a longer-lived kiosk reservation, which is a protocol change
and out of scope for V2.

---

## No account

Nothing in V2 needs one, and none was added: no email, social, Google, or Apple sign-in, no
profile, no cloud dashboard. The account-free model is what makes the public-computer and kiosk
promise ("nothing to log out of") true. A future optional account would need a concrete need that
cannot be met safely without one. Trusted devices, below, are designed not to need one.

---

## Future native app: what a website cannot do

The native app's job is the system integration that a website cannot provide well. It should not
duplicate the web flows.

| Capability                                                         | Feasibility                             | Notes                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------ | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Share from another app on **iOS** (KakaoTalk → Share → Print-cess) | Needs a native app                      | iOS has no web share target. A Share Extension receives the file and hands it to the same send pipeline: chunked AES-256-GCM, the transfer code generated on device, and the code delivered by QR, link, or the four-digit hand-off.                                                                                                                                                  |
| Share from another app on **Android**                              | Native now; web only if installed       | The Web Share Target API works only for an installed PWA with a manifest. `BRAND.md` deliberately ships no manifest so that a visit ends with site data cleared. A native Sharesheet target avoids reversing that decision.                                                                                                                                                           |
| Choose a destination after sharing in                              | Feasible with native app                | The destination step is the existing split: "another device or person" is Share (`SendFlow` already accepts files in hand through `initialFiles`, which is how Scan hands over), and "a nearby printer" still needs a kiosk QR code, because only the kiosk can create a print session. A share extension could open the camera for that QR and then upload into the claimed session. |
| Nearby Print-cess printers as a list                               | Speculative                             | It would need a printer directory, location data, and a way to reserve a kiosk without the QR code in the room. Each of those is a new privacy and abuse surface. The QR code currently proves physical presence.                                                                                                                                                                     |
| Trusted personal devices (below)                                   | Feasible with native app; partly on web | Persistent identity is incompatible with public computers and kiosks by design. It belongs only on devices the visitor owns.                                                                                                                                                                                                                                                          |

### What V2 already prepares

- **Files in hand.** `SendFlow` accepts `initialFiles` and a `back` action, and carries the
  language already chosen. Scan uses this today. A share extension or a share-target page would
  enter the same way, so there is no second upload implementation to keep in sync.
- **One source picker.** `SourcePicker` is the single place a file source is offered, so a native
  "shared from another app" source fits beside Photos and Files.
- **Capability-shaped routes.** Print, Share, and Scan are separate flows with no shared mode
  state, so a native shell can deep-link into any of them (`/receive#c=…` already works as a
  universal link target).

## Trusted devices (future architecture, not implemented)

The goal is a list such as "My iPhone, My MacBook, Office PC" in place of a code, without an
account and without weakening the transfer model.

A defensible design:

1. **Pairing is explicit and in person.** Two devices pair by scanning a QR code, which carries a
   one-time pairing secret and the scanner's public key, and confirm a short comparison code on
   both screens.
2. **Each device holds a long-term key pair** generated on the device (a non-extractable Web
   Crypto key in IndexedDB on the web; Keychain or Keystore natively). Device names are chosen
   locally and stored only on the two devices, never on the server.
3. **The service relays, it does not know.** A transfer to a trusted device is an ordinary drop.
   Its transfer code is encrypted to the recipient's public key and left in a mailbox addressed by
   an opaque, rotating identifier. The server sees ciphertext and an identifier, as it does today.
4. **Revocation is local and immediate.** Removing a device deletes its key and mailbox address.
   A stolen device is handled by revoking it from the other one.
5. **Never on shared machines.** Kiosks, browser-kiosk displays, and managed workstations must not
   create or store a device identity. A workstation that clears site data per policy would lose it
   anyway, and keeping it would contradict the public-computer promise.

Open problems before any of this ships: mailbox abuse and rate limiting without accounts, key
rollover, a recovery story for a lost single device, and a threat-model review in
`THREAT_MODEL.md`. Until those are answered, codes and QR remain the only addressing model.

---

## Deliberately not in V2

- A native iOS or Android app. The repository has no native mobile project.
- A web share target or a web app manifest (see above).
- Scanning inside a kiosk print session (session lifetime).
- Persistent device identity, transfer history, or contacts.
- Accounts of any kind.
- Any change to the transfer protocol, encryption, storage adapters, printer path, or kiosk runtime.
