# "This site can see edits you make" file-dialog warning

A visitor reported a Windows file dialog during printing whose title read, approximately,
"Warning: This site can see edits you make" (`경고: 이 사이트에서 사용자가 수정한 내용을 볼 수
있습니다`). This document records what produces that dialog, which Print-cess code can and cannot
reach it, and what to collect when it is reported again.

## What the title means

The text is not a Windows or printer-driver string. It is the title Chromium gives the native file
dialog it opens for the File System Access API's `window.showSaveFilePicker()`:

- `chrome/browser/file_system_access/chrome_file_system_access_permission_context.cc`,
  `GetPickerTitle()`: the `kSaveFilePickerOptions` case, and only that case, uses
  `IDS_FILE_SYSTEM_ACCESS_CHOOSER_OPEN_SAVE_FILE_TITLE`.
- `chrome/app/generated_resources.grd`: `IDS_FILE_SYSTEM_ACCESS_CHOOSER_OPEN_SAVE_FILE_TITLE` is
  "Warning: this site can see edits you make".
- `chrome/app/resources/generated_resources_ko.xtb`: the Korean translation is
  `경고: 이 사이트에서 내가 수정한 내용을 볼 수 있습니다`.

Other pickers carry different titles: `showDirectoryPicker({ mode: "readwrite" })` is "Select where
this site can save changes", a read-only directory picker is "Select a folder this site can view",
and `showOpenFilePicker()` is "Select a file this site can read". An ordinary browser download
("Ask where to save each file") and a printer driver's print-to-file prompt ("Save Print Output
As") use the platform's default title and never show this warning.

Chromium shows the warning because the API returns a file handle the page could keep writing to
after the dialog closes. It is a disclosure of the permission being granted, not evidence that
anything was read or sent.

## Where Print-cess can and cannot produce it

Ordinary file saves do not request file-system permission in these paths:

- Browser kiosk printing, staff downloads, and Scan printing.
- Native Windows kiosk printing, which does not use Chromium.
- `/receive` single-file Save and default Save all: ordinary browser downloads.

The separately selected `/receive` "Save all to folder" action does call
`showDirectoryPicker()`, which uses a different browser permission title.

The only `showSaveFilePicker()` call is `openFilePicker()` in
`apps/web/src/lib/drop-save.ts`. As of 2026-10-21, it is gated behind an explicit
`preferFilePicker: true` option and is **not invoked by the normal receive UI**.
`saveOne()` and the default `saveRemaining("download")` use regular downloads.
The explicitly selected `saveRemaining("folder")` uses `showDirectoryPicker()`,
which presents a different browser permission dialog.

Decision (2026-10-21, superseding the 2026-10-12 UI default): the desktop receive
flow must not grant direct file-write permission merely to download a document.
Browser download settings control where the file lands. The UI correctly reports
"Download started" rather than claiming a confirmed disk write. An agency's
managed download restrictions remain in force; this change never bypasses them.

Outside Print-cess code, two Chromium-side callers exist and cannot be excluded remotely:

- Chrome's built-in PDF viewer saves through `showSaveFilePicker()` when the
  `PdfUseShowSaveFilePicker` feature is enabled (disabled by default, but field trials can enable
  it). A save in the viewer (Ctrl+S, or the viewer's download button) would show the same title.
- A browser extension or a site in another tab can call the API.

## Regression guards

- `apps/web/test/kiosk-print.test.ts` fails if PDF, PNG or JPEG printing calls
  `showSaveFilePicker`, `showDirectoryPicker` or `showOpenFilePicker`.
- `apps/web/test/e2e/print-flow.spec.ts` ("one kiosk scan prints multiple…") records every picker
  call in real Chromium while a PNG and a PDF go through the kiosk and fails on any call.
- `apps/web/src/lib/drop-save.test.ts` asserts that the normal save target never
  opens a Chromium file picker, even when the browser supports it.
- `apps/web/test/e2e/drop-flow.spec.ts` checks that default single and bulk
  downloads never request file-system picker permission on a receiver.

## When it is reported again

Collect, without any real document:

1. A screenshot of the whole dialog, including its title bar.
2. The address of the tab that was in front when the dialog opened (`/kiosk`, `/receive`, `/scan`,
   or something else) and the last button pressed.
3. `chrome://version` or `edge://version`, including the "Variations" / command-line section, and
   whether `PdfUseShowSaveFilePicker` appears there.
4. The list of installed extensions (`chrome://extensions`).
5. The selected printer's port in Windows printer properties (`FILE:`, `PORTPROMPT:`, or a
   virtual writer such as Microsoft XPS Document Writer).

Then classify it:

| Dialog title                                            | Origin                                                              | Action                                                   |
| ------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------- |
| "Warning: this site can see edits you make"             | `showSaveFilePicker()` by the page, the PDF viewer, or an extension | Match the tab address and button against the table above |
| "Select where this site can save changes"               | `showDirectoryPicker({ mode: "readwrite" })`                        | `/receive` "Save all to a folder…"                       |
| "Save Print Output As" / "다른 이름으로 인쇄 결과 저장" | Printer driver or `FILE:` port                                      | Printer configuration, not Print-cess                    |
| Platform "Save As" / "다른 이름으로 저장"               | Ordinary browser download                                           | Download setting or the staff download link              |

Do not suppress or work around the Chromium warning. It is browser security UI.
