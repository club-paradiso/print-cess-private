# Device, accessibility, and native-language acceptance

Automated linting, axe checks, browser simulators, and machine-translated resources are development
evidence only. Production requires observed testing on supported phones and the target Windows
kiosk plus independent native-language review. Use synthetic documents and never capture a live QR,
URL fragment, signed URL, document preview, or provider credential in an attachment.

## Device matrix

At minimum test the oldest and newest institution-supported combinations:

- iPhone Safari on a small and current large viewport;
- Android Chrome on a small and current large viewport;
- target Windows 10/11 image, display scaling, screen, speakers, keyboard, and kiosk policy;
- cellular paths from at least two carriers while the desktop uses its production-like wired path.

For every combination run the language picker in the header, the help sheet on each step, the photo
picker, the file picker, PDF/JPG/PNG preview, approve, progress, completion, QR
expiry/reuse, network loss, locked/damaged/oversize document, cancelled picker, refresh/back, and
reduced-motion paths. Add the paths that only appear once a document is committed: a status poll
that fails and recovers, and one that never recovers. On the shared kiosk display, watch one full rotation of the eleven-language
scan instruction and confirm no line clips or reflows the layout.
Record OS/browser version, viewport/scaling, assistive technology, commit/deployment, tester, UTC time,
result, and sanitized issue link.

Every screen in the service is opened on the visitor's own phone, so every one of them resolves the
language from the request's `Accept-Language` header and renders in it directly, with the picker
available in the header. The print flow used to ask on a screen of its own; it no longer does, and
a language screen reappearing anywhere is a regression. Verify with the phone set to each supported
language that the first painted screen is already in that language and never visibly changes
afterwards, and that `<html lang>` and `dir` match it before hydration. A page that loads in English
and then switches is a defect even though the final state is correct.

Verify too that scanning lands on the file chooser: nothing may stand between the QR and the choice
the visitor came to make. The guide belongs in Help, reachable and never blocking.

## Accessibility protocol

Run keyboard-only navigation and visible focus on every action. With VoiceOver, TalkBack, and the
target Windows screen reader, verify reading order, labels, selected language, step/progress changes,
error announcements, dialog/focus return, file-picker recovery, and completion. Verify at 200% text
zoom and 400% browser zoom/reflow where applicable, high contrast, portrait/landscape, large text,
reduced motion, and muted audio. The visitor flow carries no spoken guidance, so text must be
sufficient on its own — without color, icon, animation, or sound.

Measure the real rendered foreground/background colors and require WCAG 2.2 AA contrast: 4.5:1 for
normal text, 3:1 for large text and non-text controls/focus. Confirm 64px primary actions remain
usable, no horizontal scrolling blocks the task, no timed step expires without a clear recovery,
and the 30-second reminder does not trap or repeatedly interrupt assistive technology.

Any inaccessible file picker, unlabeled control, hidden focus, clipped translation, unannounced
blocking error, contrast failure, or inability to finish the primary flow is release-blocking.

## Native-language review

One qualified native reviewer per locale must review all visible text in context, for both the
print flow and the file hand-off:

| Locale  | Language         | Reviewer/sign-off required |
| ------- | ---------------- | -------------------------- |
| `en`    | English          | Yes                        |
| `ko`    | 한국어           | Yes                        |
| `zh-CN` | 简体中文         | Yes                        |
| `id`    | Bahasa Indonesia | Yes                        |
| `fil`   | Filipino         | Yes                        |
| `vi`    | Tiếng Việt       | Yes                        |
| `mn`    | Монгол           | Yes                        |
| `th`    | ไทย              | Yes                        |
| `ru`    | Русский          | Yes                        |
| `ne`    | नेपाली            | Yes                        |
| `km`    | ខ្មែរ             | Yes                        |
| `ar`    | العربية          | Yes                        |
| `uk`    | Українська       | Yes                        |

Reviewers must confirm plain meaning, respectful neutral tone, action consistency, file-location
instructions, the exact `A4 한 부 인쇄` intent, no implication of government endorsement, no
promise the service cannot keep, correct response when the user lacks a phone/data/file, and
professional error recovery. Review at actual device widths; a string-level spreadsheet alone is
insufficient.

Reviewers must also judge the copy against the reading level the service actually needs. Every
visible string is written for a visitor who has never used a kiosk and may read slowly, so each
reviewer confirms in their own language that: sentences carry one idea, a control is named with the
exact words printed on it rather than by colour or position, the help sheet answers "what do I do
now" for the screen it was opened from, and the closing offer of staff help never replaces a
concrete instruction. Whenever visible copy changes, every locale is reviewed again — a previous
sign-off does not carry over, because the wording of one locale is no longer maintained separately
from the rest.

### Pre-review pass already performed

Before this reaches a native reviewer, the copy has had a systematic authoring pass and now carries
automated guards. This exists to make a reviewer's hour productive, **not** to reduce what they are
signing for. It is not a substitute for their judgement and does not satisfy the closure evidence
for R-17.

What the automated tests in `packages/i18n` now guarantee, so no reviewer needs to spend time on it:

- every key exists in every locale, with the same interpolation placeholders;
- help text that quotes a button label quotes a label that actually exists in that same locale, so
  an instruction can never name a control that is not on the screen;
- the `HWPX` token stays literal, so the phone can still rewrite it to `HWP/HWPX`;
- no locale mixes native and Latin numerals for the same kind of count;
- Korean stays in one politeness register across the whole flow.

What the authoring pass found and corrected, as examples of the class of defect that remains
possible and that only a reader of the language can catch:

| Locale | Defect                                                                                                               | Correction                               |
| ------ | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| all 13 | The confirmation screen called the thing being closed a "tab" while the button above it called it a "page"           | One noun everywhere, matching the button |
| `ko`   | Three strings in `합니다체` inside a `해요체` flow, one of them mixing both registers in a single pair of sentences  | Normalised to `해요체`                   |
| `km`   | Khmer numerals for counts on the same screen as Latin-numbered step titles                                           | Latin numerals throughout                |
| `ru`   | `шаг сделан` (calque); imperfective `Забирайте` contradicting the perfective used for the same instruction elsewhere | `шаг уже выполнен`; `Заберите`           |
| `uk`   | `крок готовий` reads as an object being ready rather than a step being done                                          | `крок уже виконано`                      |
| `mn`   | Ablative marker governed only the second size limit, so the first read as a bare apposition                          | Marked both limits                       |
| `id`   | `halaman yang perlu` missing the passive                                                                             | `halaman yang diperlukan`                |
| `fil`  | Doubled `wala pang` construction, hard to parse aloud                                                                | `mas maliit sa`                          |

**What this pass cannot establish.** Whether the copy sounds like a person rather than a translation;
whether the register suits a public counter in that language; whether an instruction is
understandable to someone reading slowly under stress; whether a word carries an unintended
connotation. Those require a qualified speaker, and R-17 stays
open until thirteen of them have signed.

## Approval record

Acceptance is complete only when the product/accessibility owner and all thirteen language reviewers
sign a dated matrix tied to a commit and Preview deployment, every blocking issue is closed and
retested, and the target-device evidence is attached to the institution's private system of record.
Export only opaque reviewer/attestation references and hashes into the `accessibilityLanguage` stage
described in `READINESS_EVIDENCE.md`; the validator requires distinct qualified reviewers for all
thirteen locales and the complete device/accessibility matrix. It checks completeness, not reviewer
identity or authority.
No native-speaker or physical-device approval was available during the current implementation.
