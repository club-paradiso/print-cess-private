# ADR 0001 — A received file has a destination, and the destination decides what we may claim

- **Status:** Accepted
- **Date:** 2026-08-15
- **Supersedes:** the single `DropWriter` in `apps/web/src/lib/drop-writer.ts`

## Context

Receiving a file used to end one way. Chunks were decrypted into either the
private origin file system or a list of arrays in memory, the result was wrapped
in a `Blob`, an anchor was clicked, and the screen said **Saved**.

Only one of those words was reliable. Clicking an anchor asks the browser to
download something; what follows is the browser's business. On iOS Safari it may
open a preview or a sheet. On any browser it may be refused, redirected, or
dropped. The private origin file system compounded the confusion: it is real
storage, so it feels like a save, but it is invisible to the visitor and exists
only to keep a large file off the JavaScript heap.

Two more things were wrong underneath. A transfer of several files was one
operation: a failure on the third of five threw away the knowledge that the
first two had arrived, and the retry started again from the beginning. And a
browser with no private origin file system would happily try to assemble a
two-gigabyte file in memory on a phone, which is not a fallback but a crash with
extra steps.

Meanwhile, capable browsers had something better than any of this and it was
unused: a save dialog and a folder picker that return a writable handle, so the
file goes exactly where the visitor said, and closing it is a fact rather than
an inference.

## Decision

A received file is written into a **save target**, chosen once, during the tap
that asked for it, and each target reports its own outcome.

```text
pickSaveTarget(file)          →  picked-file      → "saved"
pickDirectoryTarget()         →  picked-directory → "saved"
downloadTarget(size)          →  download         → "downloadStarted"
shareReceivedFile(file, …)    →  share sheet      → "shared"
```

`downloadTarget` internally stages through the private origin file system where
it exists and falls back to memory where it does not, but both report
`downloadStarted`, because that is the last thing either can observe. Staging is
an implementation detail of keeping a large file off the heap, not a location.

Four things follow from this and are the reason for the shape:

1. **The picker opens inside the user activation.** By the time a
   multi-gigabyte file has finished arriving, the activation that would have
   allowed a dialog is long gone. So the destination is chosen first and the
   bytes are fetched into it, rather than the other way round.
2. **The transfer layer takes a sink.** `receiveDropFile` writes chunks and
   returns whatever the sink says happened. It has no opinion about saving, and
   the save module has no opinion about chunks.
3. **State is per file.** Each file carries waiting / saving / saved /
   downloadStarted / shared / failed, so a retry asks only for what is missing
   and nothing already saved is fetched twice.
4. **Memory has a ceiling.** With no staging available, a file over 512 MiB is
   refused in a second rather than crashing the tab four minutes later; over
   128 MiB the screen warns first.

Everything is feature-detected. There is no user-agent branch in the save path,
because "does this browser expose this API" is a question the browser answers
directly and a user-agent string answers badly.

## Consequences

Wording is now load-bearing and has to be translated as such: "Saved" and
"Download started" are different claims in all thirteen languages, and a
translator who collapses them reintroduces the bug.

Desktop Chrome and Edge visitors get a genuinely better experience — a real save
dialog, and one folder choice for a whole transfer. Safari, Firefox, and every
phone get exactly the behaviour they had before, described accurately.

The end-to-end tests cannot drive the native dialogs, so they delete
`showSaveFilePicker` and `showDirectoryPicker` and exercise the fallback, which
is the path with something observable. The direct-write path's wording is pinned
in `drop-save.test.ts` against fake handles, and real dialog behaviour is on the
manual acceptance matrix in `FILE_COMPATIBILITY.md`. This is a real gap and is
recorded as one rather than papered over.

## Alternatives considered

**Keep one writer and soften the copy to "Saved or downloaded".** Rejected:
vague in every language, and it would have left the capable-browser experience
unbuilt.

**Always use the file picker where it exists, with no download fallback.**
Rejected: it makes a dismissed dialog into a dead end, and most visitors are on
phones where the picker does not exist at all.

**Zip a whole transfer for a single download.** Rejected for now. It adds a
compression dependency, assembles the whole transfer somewhere before it can be
downloaded, and takes away the ability to save one file out of five — which is
the thing people actually want. The folder picker solves the same problem better
on the browsers that have it.

## UI policy update (2026-10-21)

The original destination semantics and the direct-write implementation remain valid,
but `/receive` now **defaults to regular downloads** for both single-file and
bulk actions. Chromium's `showSaveFilePicker()` causes a browser security
warning about the site's ability to see edits, which confused users on managed
agency computers. The picker remains available to callers that explicitly opt
in with `preferFilePicker: true`, but no longer runs as a side effect of the
normal Save button. Direct folder writes are a separate optional button.

The outcome contract is unchanged: a browser download means `downloadStarted`,
not `saved`. Security/DLP restrictions are not bypassed. This update supersedes
the old default choice, not the file-integrity or reporting guarantees.
