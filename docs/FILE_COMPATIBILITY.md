# File compatibility

What the hand-off at `/send` and `/receive` will carry, what it does to a file
name, where a received file actually ends up, and which of those claims is
guaranteed by the protocol, covered by an automated test, dependent on the
browser, or still waiting on a physical device.

The printing flow is a different thing and has different answers: it accepts
only what the kiosk can render, and it validates content because it is about to
put it on paper. Everything below is about the hand-off.

---

## Format blindness is the design

The transfer layer knows five things about a file: its bytes, its name, its
size, an optional media type, and where each chunk sits in the transfer. It
never opens a file, never parses one, and never decides that a `.pdf` should be
treated differently from a `.bin`.

That is what makes it safe for Hancom documents, which most phones report with
no media type at all — and it is also the security position. A service that
parsed arbitrary formats to be helpful would have taken on every parser as an
attack surface in exchange for an icon. Icons here come from the extension and
the declared type alone.

The one place a received file is inspected is the point where its name reaches
a file system, and there the name is treated as hostile text from another
person's device. See "File names" below.

---

## Tested formats

`apps/web/test/integration/drop-compatibility.test.ts` drives synthetic samples
through the real API routes, the real signed-URL transport, and the real chunk
encryption, and compares the SHA-256 of what went in with what came out. The
fixtures live in `packages/test-fixtures/src/formats.ts`; each begins with the
real magic bytes of the format it stands for and is otherwise deterministic
filler. None of them is a real document, and none ever should be.

| Group         | Covered by the digest test                                                     |
| ------------- | ------------------------------------------------------------------------------ |
| Documents     | PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, HWP, HWPX, RTF, ODT, ODS, ODP            |
| Text and data | TXT, CSV, TSV, MD, JSON, XML, YAML, YML, HTML, CSS, JS, SQL                    |
| Images        | JPG, JPEG, PNG, HEIC, HEIF, WebP, GIF, BMP, TIFF, SVG                          |
| Audio         | MP3, M4A, AAC, WAV, FLAC, OGG, Opus                                            |
| Video         | MP4, MOV, WebM, MKV, AVI                                                       |
| Archives      | ZIP, 7Z, RAR, TAR, TAR.GZ, TGZ, GZ                                             |
| Generic       | `.bin`, unknown extension, no extension, dotfile, several dots, empty MIME     |
| Misleading    | PNG bytes declared as `application/pdf` — carried unchanged, neither corrected |

**This list is not a list of what the service supports.** It is a list of what
has been checked. Format blindness means an unlisted format behaves identically;
the table exists because "it should work" is not evidence.

`apps/web/test/e2e/hancom-handoff.spec.ts` repeats the Hancom round trip through
two real browsers, because that pair is what the service exists for.

---

## File names

One policy, in `apps/web/src/lib/drop-file-name.ts`, applied twice: on the
sending phone before a name is sealed into the manifest, and again on the
receiving phone before a name reaches a picker, a directory handle, or a
download attribute. The second application is the one that matters for safety —
by then the name arrived from another device and is exactly as trustworthy as
any other byte in the transfer.

**Removed, always.** Path separators, C0 and C1 control characters, the
characters Windows refuses (`: * ? " < > |`), and the bidirectional overrides
that let a name ending in `.exe` paint itself as a `.png`. Because separators
are replaced rather than trimmed, no output of the policy contains one at all,
so traversal is impossible by construction rather than by filtering.

**Bounded by bytes.** 180 UTF-8 bytes, not 180 characters. A count of characters
means something different in every script: 180 Korean characters cost 540 bytes
and 180 emoji cost 720, and twenty such names overflowed the encrypted file
list's ceiling after base64 — a selection the phone had already accepted. A
UTF-8 byte count is never smaller than a UTF-16 length, so the byte budget also
satisfies the manifest schema's older limit.

**Preserved.** The extension survives truncation: a very long `.pdf` is
shortened in the middle and still ends in `.pdf`. A single leading dot is kept,
so `.gitignore` stays a dotfile. Every dot of `archive.tar.gz` is kept.
Composed and decomposed spellings stay distinct rather than being normalized
into each other.

**Adjusted.** Two or more leading dots collapse to `_`. Trailing dots and
spaces are dropped, because Windows drops them silently and the file would
otherwise be stored under a name nobody chose. The MS-DOS device names (`CON`,
`PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`) are prefixed with `_`;
ordinary words that merely begin the same way, like `console.log`, are left
alone. A cut never falls inside a grapheme, so a family emoji or a decomposed
Hangul syllable stays whole.

**Never empty.** A name that sanitizes away becomes `file`.

Media types are advisory and are dropped rather than corrected: anything that is
not shaped like a media type, and anything longer than 128 characters, becomes
the empty string. A shortened media type is a different media type, and
declaring the wrong one is worse than declaring none — which is already the
ordinary case for Hancom documents.

Names in Korean, Chinese, Japanese, Arabic, Hindi, Vietnamese, Indonesian,
Tagalog, French, and emoji are all covered by `drop-file-name.test.ts` and by
the round-trip matrix.

---

## Sizes and limits

| Limit                     | Value                              | Where it is enforced                  |
| ------------------------- | ---------------------------------- | ------------------------------------- |
| Files per transfer        | 20                                 | Phone, then the create request schema |
| Plaintext bytes           | `DROP_MAX_TOTAL_MB` (default 2048) | Phone, then the create route          |
| Parts per transfer        | 4096                               | Protocol                              |
| Plaintext bytes per chunk | 8 MiB                              | Protocol                              |
| Encrypted file list       | 16 KiB after base64                | Phone, measured, then the schema      |
| File name                 | 180 UTF-8 bytes                    | Phone and receiver                    |

`GET /api/drops/capabilities` publishes the first four so the sending phone can
refuse a selection this deployment would never accept, before spending several
hundred milliseconds on key stretching and minutes on an upload. It carries
product limits only and describes nothing about the storage or the database
behind them.

The ceiling is measured in **bytes**, not in parts. It used to be a part count
derived from the byte ceiling, which refused twenty one-kilobyte files on a
deployment configured for sixty-four megabytes: twenty files need twenty parts
and the division allowed eight. The create request now declares its plaintext
size, the schema pins the part count between the floor and ceiling that size can
legitimately need, and every commit is checked against the declared size plus
one authentication tag per part — inside the same atomic mutation as the commit,
using sizes read back from the storage provider rather than taken from the
request.

**Zero-byte files transfer.** An empty file is a real file, and a general
transport that refuses one is broken. AES-GCM over empty plaintext produces the
authentication tag alone: a complete, authenticated, correctly sized part, bound
to its transfer and its position by exactly the same additional data as any
other chunk. Nothing about the security argument changes, so nothing about the
protocol version needed to. The manifest schema accepts a size of zero and the
part schema's floor is one tag rather than one byte.

**Folders are not transferred.** See the decision below.

---

## Where a received file goes

`apps/web/src/lib/drop-save.ts` picks a destination once, during the tap that
asked for it, and the destination decides what the screen is then allowed to
say. This distinction is the point of the module: a file written through a
handle the visitor chose is **saved**, and a blob handed to the download
machinery has **started a download** and nothing more.

Normal `/receive` Save and Save all actions use a browser download, staged in
private origin storage where available (or memory otherwise), and report
`downloadStarted`. Explicit direct folder saves report `saved` only after
writing and closing the file. A direct file picker remains available to internal
callers with `preferFilePicker: true`, but the default receive UI does not call it.
The system share sheet separately reports delivery to another app.

Normal "Save" and "Save all" on `/receive` use ordinary browser downloads,
including on Chromium desktop. The user may separately select "Save all to folder"
if they knowingly want to grant write permission to a chosen directory.

For direct-write modes, permission is obtained inside the user activation. By
the time a multi-gigabyte file finishes arriving, the activation that would
have allowed a picker to open is long gone, so a destination asked for later
never opens at all.

Private origin storage is **not** a user-visible location. It exists to keep a
large download off the JavaScript heap; the staged copy is handed to the
download machinery and then deleted. It is never treated as "the file is saved".

Without private origin storage, a file larger than 512 MiB is refused before the
download starts rather than crashing the tab several minutes in: both the chunk
list and the blob built from it are live at once, so the real cost approaches
twice the file size. Above 128 MiB the receiving screen warns first.

Saving into a chosen folder never silently replaces a file already in it; a
conflicting name becomes `photo (2).jpg`, checked against the folder itself
rather than only against what this session wrote.

---

## Per-file outcomes

Each received file carries its own state — waiting, saving, saved, download
started, sent to another app, or failed — with its own Save and, where the
browser supports it, Share. A failure on the third of five does not discard the
two that arrived: the retry asks only for what is missing, and nothing already
saved is fetched a second time.

The completion line reflects what actually happened. If every file was written
through a picker, it says every file is saved. If any of them went through the
download path, it says they were handed over and points at Downloads or Files.

---

## Browser and platform notes

Feature detection only. There is no user-agent sniffing anywhere in the save
path, because the question is always "does this browser expose this API", which
is a question the browser can answer directly.

| Browser             | Save picker | Folder picker | Private origin storage | Share files | Camera scan |
| ------------------- | ----------- | ------------- | ---------------------- | ----------- | ----------- |
| Desktop Chrome/Edge | Yes         | Yes           | Yes                    | Varies      | Varies      |
| Desktop Safari      | No          | No            | Yes                    | Varies      | No          |
| Desktop Firefox     | No          | No            | Yes                    | No          | No          |
| iOS Safari          | No          | No            | Yes                    | Usually     | Usually     |
| Android Chrome      | No          | No            | Yes                    | Usually     | Usually     |

"Varies" and "usually" are honest: these depend on version, on whether the
context is secure, and on what the operating system offers. Every one of them is
detected at runtime rather than assumed, and every one has a fallback that works
without it. QR scanning uses `BarcodeDetector` where it exists and falls back to
the twelve-character keypad everywhere else.

---

## What is proven by what

- **Guaranteed by the protocol.** Chunk ordering, per-file keys, authentication
  of every chunk against its transfer and position, refusal of a reordered,
  moved, altered, or truncated chunk, the part and size ceilings, and the
  transfer expiry.
- **Covered by automated tests.** The format matrix by digest, the file-name
  matrix, the media-type matrix, empty files, multi-chunk files, twenty files in
  one transfer, the limit boundaries, the manifest budget, tampering, save
  outcomes, folder conflict handling, and the memory refusal threshold.
- **Browser-dependent.** Which destination is chosen, whether a share sheet
  appears, what the operating system offers inside it, and where a download
  actually lands.
- **Verified only in Chromium so far.** The end-to-end runs, including the
  Hancom round trip. Playwright's WebKit is not iOS Safari, and a download that
  works there is not evidence about a real iPhone.
- **Still requiring a physical device.** Everything in the acceptance matrix
  below.

---

## Manual acceptance matrix

CI cannot answer where a file lands on a real phone. Before a release, on a
recent iPhone Safari, a recent Android Chrome, desktop Chrome or Edge, and
desktop Safari, verify:

1. one small file, saved, and found afterwards;
2. five files: save one alone, then save the rest;
3. a file over 100 MB where practical, with the screen kept awake throughout;
4. a non-ASCII file name — Korean is the case that matters here — arriving with
   its name intact on disk. A browser running outside a UTF-8 locale sanitizes
   such a name down to `download`, which is a property of the environment rather
   than of the service; CI pins `LANG` and `LC_ALL` for exactly this reason, and
   a device check should confirm the locale before blaming the transfer;
5. an HWP and an HWPX with no media type at all;
6. an unknown binary with no extension;
7. aeroplane mode mid-transfer, then restored: the transfer resumes and the
   screen never claims a failure it cannot know about;
8. Share, where the button appears, into at least Files and one messaging app;
9. on desktop Chrome, "Save all to a folder…" into a folder that already
   contains a file of the same name.

Record what was seen, not what was expected. A green CI run is not evidence
about any of these.
