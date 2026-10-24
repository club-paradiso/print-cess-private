# The document journey

How a visitor experiences a document moving from their phone to paper, and how
two phones experience files moving between them. This is the design record for
the screens: what they say, in what order, why some of them stopped existing,
and what the motion and the colour are allowed to mean.

The engineering is complicated. The experience must not be.

---

## The product, in one glance

```text
FILE   →  DESTINATION  →  TRANSFER
PAPER  →  DIGITAL FILE →  DESTINATION
```

Print-cess has three capabilities: **Print** (a file becomes paper), **Share** (a file reaches
another device or person), and **Scan** (paper becomes a PDF). The home page leads with Print,
shows its three steps once, puts Share and Scan below as smaller sheets, and closes with the
entrances for the people who run the service (**Use this device as the print screen** and the
managed workstation). `PRODUCT_V2.md` records the reasoning and the future native path;
`PRINT_FIRST_ENTRY.md` records this hierarchy.

- **Print** leads the home page with the question "Here to print?" ("인쇄하러 오셨나요?"), the
  Beacon, and the instruction to find the Print-cess screen next to the printer. It starts at
  that screen's QR code, and only the screen can open a print session, so nothing on the home
  page links to a print route. Its two buttons open sheets: "Scan QR code" reads the screen's
  QR code from the home page after checking it is a Print-cess session on this site, and "I
  can't find the screen" shows three steps for finding it.
- **Share** is one capability with two sides. The home offers "Choose files to send" and,
  quieter, "Receive files with a code". `/send` and `/receive` carry the same "Share" label and
  link to each other. A visitor who arrives from a transfer QR code or link skips every choice
  and lands in receiving.
- **Scan** ends in a destination: on through Share, downloaded, handed to another app where the
  browser can share that exact PDF, or printed through this device's own print window.
- **Display setup** and the **managed workstation** share the workplace group at the bottom of
  the page, below a hairline after the visitor tools. They are for the people who run the
  service, so they no longer compete with the visitor's first action.

---

## Print: the fast path

```text
SCAN  →  CHOOSE FILE  →  CHECK IT  →  PRINT  →  COLLECT
```

That is the whole flow. A visitor who has just scanned a code sees the file
chooser, in their own language, and nothing else stands in front of it.

Two screens used to. **Choose your language** asked a question the visitor's own
browser had already answered — the QR code is on a shared kiosk, but the browser
that scans it is theirs, and it carries `Accept-Language`. **How to print**
taught a first-time visitor four steps at the cost of everyone else, every time.
Together they were two screens and two taps spent before the visitor saw the
thing they came to do.

Both are still available, neither is in the way:

- the language picker sits in the header, for the times the browser's answer is
  wrong;
- the guide lives in Help, reachable from the header and from a quiet link on
  the file screen itself.

The server resolves the language and renders the first paint in it, so nobody
watches the page load in English and then change under them.

### The friction budget

| Moment                                  | Taps |
| --------------------------------------- | ---- |
| Page open → file-source buttons visible | 0    |
| Choosing a source (Photos or Files)     | 1    |
| Confirming the print                    | 1    |

The file step offers **Photos** and **Files** as two equal tiles. What the visitor holds decides
which one they need (a screenshot of a booking is in Photos, an emailed PDF in Files), so
neither is styled as the expected answer. Scanning is not offered here: a claimed session lives
three minutes by default, and a multi-page scan can outlast it. Scan first, then print the PDF.

`Print one copy` stays. It is the one irreversible, outward-facing action in the
flow — paper comes out of a machine in a room — and it deserves a deliberate
tap. Nothing else may be added beside it: a second "are you sure?" would be
ceremony, not safety.

### Phone screens, 2026-10-13 pass

Observed on a 390×844 phone, then changed:

- **Each tile says what lives behind it.** "갤러리·카메라로 찍은 사진" under Photos, "PDF, 카톡·메일로
  받은 파일" under Files, so the choice no longer needs Help.
- **Time left is shown while choosing** ("2:59 안에 인쇄 버튼을 눌러 주세요"), quiet until the last
  30 seconds, then amber. It is the claimed session's own expiry, so the number is never a guess.
- **The print button is pinned to the bottom of the screen.** A tall single-page preview used to push
  it below the fold; it now sits in a sticky bar with "choose another" under it, and the preview
  is capped at 40% of the screen height.
- **Waiting has visible stages**: 준비 → 보내기 → 인쇄 시작, each marked done, current or still to
  come in words and a check mark as well as colour.
- **The end says what next time looks like**: "더 인쇄하려면 큰 화면의 새 QR코드를 찍으세요."
- **Errors have a way out**: "처음 화면으로" links to `/start`, where the in-page QR scanner lives.

All new strings live in `print-batch-copy.ts` for all thirteen locales; Korean and English were
edited, the other eleven were written for meaning and need native review like the rest.

### Assisted path

Help carries everything a first-time visitor needs and an experienced one never
opens: the four steps, where documents hide (KakaoTalk, email, "I don't have
one"), what happens next, and the reminder that staff never log into anyone's
account, search anyone's phone, or type a password for them.

---

## Print: who is talking, and when

Each state names the screen that has the answer, so nobody looks at the wrong
one.

| Stage             | The kiosk says                           | The phone says                                           |
| ----------------- | ---------------------------------------- | -------------------------------------------------------- |
| Waiting           | Point your camera at the QR · 3 steps    | —                                                        |
| Phone connected   | Phone connected · continue on your phone | Pick files to print                                      |
| Document arriving | Receiving your files · Arriving          | Sending…                                                 |
| Checking          | Receiving your files · Checking          | Waiting for the printer                                  |
| Printing          | Printing · wait at the printer           | Waiting for the printer                                  |
| Done              | Take your paper from the printer         | All done · collect your document                         |
| Unavailable       | Can't print right now · retries in 30 s  | (the phone shows its own error)                          |
| Connection lost   | (unchanged — the kiosk still knows)      | Connection interrupted · the kiosk may still be printing |

The kiosk stops asking the room to scan a code the moment a phone claims the
session. Repeating an instruction the visitor has already carried out, next to a
QR that no longer works, was the single most confusing thing on the shared
screen.

### What the shared screen may show

A public display in a room full of strangers may show a **category and a stage**
and nothing else. Never a file name, never a thumbnail, never a page, never
anything that identifies the person who sent it. The document appears as an
anonymous token: a shape that arrives, is checked, and is printed.

---

## Print: the phone stops being in charge

Before the upload is committed, the phone owns the session and cancelling on
error is correct. After it, the kiosk owns the work — it may already be
validating, spooling, or printing — and the phone is a status display.

So a failed status poll never produces a verdict. It says the connection was
interrupted, notes that the kiosk may still be printing, and retries. If contact
never returns, the screen says exactly that and points at the printer, which is
the only place the answer actually exists. It never invents a failure, and it
never invents a success.

This was previously a real defect: any polling error cancelled the session,
which took back print jobs already on their way to paper and told the visitor
they had failed.

---

## Hand-off: the shape of it

```text
CHOOSE FILES  →  CODE APPEARS  →  OTHER PHONE SCANS  →  FILES ARRIVE
```

The code appears as soon as the service holds the transfer record — not when the
last byte lands. For a large hand-off that is the difference between the other
person scanning immediately and waiting with you, and staring at your progress
bar for two minutes before they are allowed to begin.

A receiver who arrives early sees **Connected · the files are still being
prepared**. Not an error, not a file list, not a progress bar belonging to
somebody else's phone, and never a hint of who is sending. Somebody guessing a
code still gets the same "not found" they always did.

### The ready screen, top to bottom

1. What the other side has done (the status below), because it is what the sender keeps
   glancing back at.
2. The QR code, the private default.
3. Share the link or copy it.
4. The optional four-digit hand-off, folded behind one line ("QR을 찍을 수 없나요? 숫자와 도형으로
   건네기"). Its trade-off (the service holds the key for three minutes) is stated inside, where
   the choice is made, and not on the pick screen.
5. Erase it now: final, quiet (a red text action, not a second big button), and never the next
   step.

Once the receipt arrives, "다른 파일 보내기" appears directly under the status, so the end of a
hand-off has a next step instead of a screen that just sits there.

### Sending screens, 2026-10-13 pass

The team was handed three public design checklists (taste-skill's redesign audit, UI/UX Pro Max's
quick reference, and Design Motion Principles). They were read as references, not installed, and
applied only where they agree with `docs/BRAND.md`. What changed, and the rule behind it:

| Change                                                                           | Rule                                            |
| -------------------------------------------------------------------------------- | ----------------------------------------------- |
| Three-step strip (파일 고르기 → 건네기 → 받음 확인) from hand-over on            | Multi-step flows show progress                  |
| Choosing stays bare: no strip on the first screen                                | V2 decision, kept (the tiles are the whole job) |
| "파일 더 고르기 / 다시 고르기" became two compact actions on one row             | One primary action; secondaries subordinate     |
| "이 파일 보내기" is pinned to the bottom of the screen                           | Primary action never below the fold             |
| The four-digit hand-off sits behind a disclosure                                 | Progressive disclosure                          |
| "지금 지우기" is a quiet text action                                             | Destructive actions separated from primary ones |
| Delivered status grows and offers "다른 파일 보내기"                             | Success feedback with a next step               |
| Each stage arrives once from 8 px below; nothing loops; off under reduced motion | Motion marks a change; rare event, subtle       |
| Headings use `text-wrap: balance` across the phone flows                         | No orphaned words                               |

Not applied, on purpose: swapping the typeface or the icon set, grain or noise textures, and
asymmetric layouts. The brand fixes those choices, and a utility used once by a stranger in a
queue gains nothing from them.

### Receiving screens, 2026-10-13 pass

The same checklists, applied to `/receive`:

| Change                                                                                                  | Rule                                     |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| The four digits are four large boxes; the next one to fill is outlined in indigo                        | Show where the user is (state clarity)   |
| A keypad key gives way under the finger (scale 0.96; off under reduced motion)                          | Press feedback                           |
| Size and time left sit above the file list, not under it                                                | Decision facts first                     |
| "아직 저장 안 했어요" only appears once at least one file has moved                                     | Rows speak only when they have news      |
| Per-file save/share buttons are compact                                                                 | A list reads as a list, not a wall       |
| "휴대전화에 저장하기" is pinned to the bottom of the screen; "다른 파일 받기" is a text action          | One primary action, never below the fold |
| When everything is out, the completion card sits above the list and "다른 파일 받기" becomes the button | Success feedback with a next step        |
| Error screens split the title from the instruction and the retry button carries an icon                 | Error states state cause and recovery    |

### What the sender is told

Four states, and the service knows all four honestly:

| State      | What actually happened                          |
| ---------- | ----------------------------------------------- |
| Waiting    | Nobody has opened it                            |
| Connected  | Somebody with the code opened the transfer      |
| On its way | A receiver asked for the first chunk            |
| Taken      | A receiver's own flow reported that it finished |

The last one is a receipt from the other phone, carrying one bit and nothing
else: no identity, no file name, no destination app, no device. The sending
screen used to say "someone picked these files up" as soon as a signed URL was
handed out, which was a guess wearing a receipt's clothes.

---

## Hand-off: what "saved" is allowed to mean

Five different things used to be called `Saved`. They are now five things:

| What happened                                     | What the screen says                          |
| ------------------------------------------------- | --------------------------------------------- |
| Written and closed into a file the visitor picked | Saved                                         |
| Written into a folder the visitor picked          | Saved                                         |
| Handed to the browser's download machinery        | Download started — look in Downloads or Files |
| Handed to the system share sheet                  | Sent to another app                           |
| Decrypted but not yet finished                    | Saving…                                       |
| Failed                                            | The reason, and a retry                       |

A UI claiming "Saved" when the browser only started a download is a correctness
bug, not a wording preference. The distinction is enforced by the destination
itself: each one returns its own outcome, and the screen renders what it was
given. Translations preserve the distinction in all thirteen languages.

Each file has its own state and its own actions, so one failure never discards
what already arrived.

---

## Scan: paper, then a destination

```text
PHOTOGRAPH PAGES  →  CHECK EDGES  →  MAKE PDF  →  SEND / SAVE / SHARE / PRINT HERE
```

The PDF is made on the phone. With no page yet, the camera is the one primary action. Once a
page exists, **Make PDF** is, and adding a page drops to a secondary control. The finished
screen has one primary action, **Send to another device**, which opens Share already holding the
PDF, with a way back to the scan. Nothing uploads until the visitor presses send there. The
quieter alternatives are one list: download (which says "download started", never "saved"),
share to another app (shown only when the browser can share that exact file), and **Print from
this device**, named so nobody mistakes the device's print window for a Print-cess printer.

---

## Motion

Motion exists to make a state change legible in less than a second. It is never
the only channel, and it never blocks anything.

- **Arrival.** The document token on the kiosk fades and rises 14px into place
  over 420ms when a phone connects. It is the only "materialization" in the
  product, and it is short enough not to be a wait.
- **Alive.** A receiver waiting on a sender sees a slow indigo pulse. It says the
  line is open; it does not pretend to be a percentage nobody can measure.
- **Hand-off.** While the phone sends a document, a sheet slides into the
  printer from the mark; while the kiosk prints, a sheet slides out of it. It
  runs only in those two states, stands in for no percentage, and is hidden
  from assistive technology because the heading beside it says the same thing.
  A lost connection is never drawn as progress: it gets a warning icon instead.
- **Progress.** Determinate bars appear only where bytes are actually counted.
  Percentages are never invented.
- **The QR never moves.** Somebody is pointing a camera at it.

`prefers-reduced-motion: reduce` is honoured globally in
`packages/ui/src/styles.css`: every animation and transition collapses, and the
hand-off drawing holds a still frame of the sheet at the slot rather than the
last frame of its loop. Nothing in the product depends on motion to be
understood, so a reduced-motion visitor loses decoration and no information.

---

## Colour and state

State is carried by the sentence first. Colour and iconography are a second and
third channel.

| State        | Hue (token)                                  | The word                  |
| ------------ | -------------------------------------------- | ------------------------- |
| Ready        | Royal Indigo (`--pc-brand`)                  | Ready / Connected         |
| Sending      | Royal Indigo (`--pc-transfer-active`)        | Sending / Saving          |
| Receiving    | Royal Indigo (`--pc-transfer-active`)        | Saving                    |
| Checking     | Royal Indigo (`--pc-printing`)               | Checking / Printing       |
| Success      | Mint Teal (`--pc-success`, `--pc-completed`) | Saved / Printed / Deleted |
| Needs a look | Amber (`--pc-warning`)                       | Reconnecting / Limited    |
| Error        | Red (`--pc-destructive`)                     | The reason                |

Work in flight used to be warm amber. It is the brand's indigo now, because
amber is reserved for the one state that asks the visitor to look twice (a
lost connection, a limited browser); an in-flight transfer is not a warning.

Both ends of a transfer use the same hue for the same meaning, so the sending
phone and the receiving phone read as one service. No state is distinguishable
by colour alone, on any screen.

---

## Sound

The kiosk plays one short, quiet tone when a print completes, so somebody who
walked away from the printer knows to come back. `?sound=off` on the kiosk URL
silences it for a counter where the tone would carry further than it helps; the
screen says the same thing either way, so nothing is lost.

That is the whole sound language, and it is deliberate: an office does not want
a service that chirps, and every other state it could announce is already
legible on screen.
Any future cue must be short, quiet, optional, have a visual equivalent already
on screen, and encode nothing about the document. Continuous tones and speech
are out.

---

## Accessibility

- Every state change is announced once, not on every poll. The status watcher
  emits a state only when it changes, so a screen reader hears the flow rather
  than a metronome.
- Touch targets are at least 44px; the code field, the language picker, and the
  per-file actions all meet it.
- Right-to-left is set on the document element with the language, and Arabic is
  checked for horizontal overflow at phone widths.
- Long translations are given room to wrap rather than truncated; file names
  wrap anywhere, because a name from another device can be long and unbroken.
- Axe runs against the mobile flow in the end-to-end suite, on desktop and on
  two phone viewports.

---

## What was deliberately not built

- **A print link on the home page.** It would have nowhere honest to go. The two print buttons
  open sheets on the same page; neither navigates until a valid Print-cess QR code is read.
- **A separate "send or receive?" question.** Sharing starts with choosing files. Receiving is
  one link away, and arriving by QR code or link skips the question entirely.
- **A mode picker.** "Simple or advanced?" is another question in front of the
  task. The fast path is the default and Help is always one tap away.
- **A separate animation protocol.** Every visual state maps to a state the
  service actually has. Nothing is animated on a timer pretending to be
  progress.
- **Auto-opening received files.** Received bytes are hostile and opaque. The
  service will hand a file to another app when the visitor asks; it will never
  render, parse, or execute one to be helpful.
