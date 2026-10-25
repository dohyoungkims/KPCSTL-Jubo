# UX study and interaction specification

## Primary tasks

1. Pastor prepares a new Sunday issue from an earlier week and edits every content section on desktop or phone.
2. Pastor or elder proposes a correction, sees its exact effects, and reviews a specific revision.
3. A church member finds this week's bulletin or a prior Sunday and reads it comfortably on a phone.

These tasks should remain available without requiring the user to learn prompting. AI is an optional editing aid; normal fields are always available.

## Recommended interface

- Desktop: persistent navigation, clear issue date/status, section controls, focused editing panel, and adjacent digital/print preview.
- Phone: four stable navigation destinations: Edit, Preview, Review, Archive. Avoid shrinking the desktop canvas into the editor. Long text gets a full-width editing area.
- Use Korean-first church vocabulary rather than database or publishing jargon. Keep short English labels where they aid bilingual users.
- Carry the source navy/gold identity into the workspace, with white editing surfaces, restrained borders, and clear content hierarchy.
- One prominent action per stage. Put publication after review; distinguish routine saved drafts from final issues.
- Show saving, saved, offline, conflict, and failure states. Never report success before persistence succeeds.
- Use previewable field changes with undo. Reset review state after a content edit and associate comments with a revision.
- Keep dates and section labels visible. Offer move-up/down buttons so reordering never requires dragging.
- Preserve Korean IME composition, cursor position, keyboard access, and visible focus. Design custom touch controls around 44 x 44 CSS pixels or larger.

## Weekly history and revision history

Weekly history is a set of independent dated issues, grouped by year and month. Revision history records changes within each issue. Both are necessary. A corrected October 4 bulletin must not replace October 11 or erase earlier October 4 PDFs.

Use an explicit Latest link plus permanent service-date URLs. Search titles, passages, and announcements. Import older PDFs under confirmed service dates; publish a structured mobile transcription only after review. Server storage, backups, and recovery are required for the real archive.

## Error and empty-state behavior

| Situation | Required response |
| --- | --- |
| Text exceeds its print region | Highlight the affected region, preserve the entered text, offer a shorter proposal or explicit layout decision |
| AI cannot finish | Keep manual edits; show retry/cancel and the request state |
| Date and weekday disagree | Show a validation warning and ask the editor to resolve it |
| Two editors change the same field | Compare revisions and recover the conflict; do not silently overwrite |
| An approved issue changes | Create a revision and require review of that changed revision |
| No archive search result | Keep filters visible and explain that no result matches |
| No prior weeks | Show the source/reference week and a clear create/import action; do not invent historical bulletins |

## Usability rehearsal

Test with the pastor and at least one elder on their actual phones. This is a proposed test, not completed user research.

1. Create next Sunday without losing the current issue.
2. Change a prayer leader and scripture reference without guidance.
3. Add, reorder, and shorten an announcement; recover a mistaken deletion.
4. Type and correct Korean text with the native keyboard.
5. Propose a change, inspect before/after content, and find it in history.
6. Read an older issue found by month and sermon keyword.
7. Export the reviewed PDF and verify the revision matches the mobile edition.

Success means completion without prompting from the facilitator, no lost content, correct interpretation of save/review state, and confidence that the older week remains available. Task duration and errors should be observed, not assumed.

## Research sources

The design decisions above are project-specific proposals informed by:

- [Nielsen Norman Group: Ten Usability Heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/): visible status, recognition, recoverability, and error prevention.
- [W3C WCAG 2.2: Target Size Minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html): 24 CSS px minimum or applicable exceptions; this is a floor, not this project's design target.
- [W3C WCAG 2.2: Target Size Enhanced](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html): 44 CSS px target guidance.
- [W3C WCAG 2.2: Focus Not Obscured](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html): sticky navigation must not conceal keyboard focus.
- [Apple HIG: Tab Bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars/): navigation destinations stay stable and distinct from action buttons.

Source review is not proof of accessibility conformance. Real-browser keyboard, screen-reader, zoom, and phone testing is still required.
