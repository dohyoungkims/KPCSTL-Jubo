# KPCSTL — completed collaboration handoff

Prepared October 24, 2026, America/Chicago. Version 0.3.

The named collaboration/progress feature is implemented and deployed. This package contains the complete current source, not the earlier unfinished snapshot.

## Move into Claude

1. Extract this ZIP into a folder on your computer.
2. In Claude Desktop, start Cowork in that folder, or create a project using an existing folder. For coding/testing/GitHub work, the Code tab can also open the same folder.
3. Ask Claude to read this file, source/README.md, source/docs/HANDOFF.md and the marked image in references/.
4. Paste CLAUDE_PROMPT.txt to continue from the completed version.

Work in the source/ subfolder for install, test, development and build commands. Keep references/ available as context. The source includes CLAUDE.md instructions, schema, migrations, tests, all PDF assets and dependencies' lockfile. Installed dependencies and secrets are excluded.

## What works now

- Name entry attached to the signed-in account; initials and names in team cards.
- Shared storage, before/after edit history, actor names and server timestamps.
- Six assigned sections with per-person completion totals and completion times.
- Completed sections reopen when content changes.
- Concurrent-edit protection and a comparison step for conflicting changes.
- Coordinator review, exact-version finalization, and final PDF export.
- Previous Sunday archives and retained earlier finalized snapshots.
- Fixed service guide, staff directory, volunteer/midweek headings and row labels.

Live app: https://kpcstl-bulletin-studio.claycorp.chatgpt.site

Open it in the same browser you used before, refresh, enter your display name, and open 팀 진행. On an empty shared store, the app imports that browser's old issues while preserving the original local copy. Existing shared dates are never overwritten by imports.

## What does not transfer with source

This ZIP does not contain the user's browser drafts or live database state. Use the app's JSON backup when moving actual church data. Host authentication, invitations and credentials are not transferred by copying files. The present workspace blocks external invitations; that hosting restriction remains. A new host must supply verified authentication and persistent storage.

GitHub publication is deferred. Nothing was pushed to dohyoungkims/KPCSTL-Jubo. Future publishing requires authorized repository access.

## Verification

36 automated checks passed, including SQLite-backed API/concurrency tests and UI-controller event flows. Production build and deployment succeeded. The fixed service guide and staff directory matched the original PDF pixel-for-pixel at 2× resolution. Real desktop/mobile browser interaction was not available for testing; see VALIDATION.md. Dynamic font fidelity, AI execution and public congregation URLs still have limits described in the handoff.

Official folder-access instructions:
https://support.claude.com/en/articles/14116274-organize-your-tasks-with-projects-in-claude-cowork
https://academy.claude.com/courses/introduction-to-claude-cowork/getting-set-up
https://code.claude.com/docs/en/desktop
