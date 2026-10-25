# GitHub Pages deployment

Public app: https://dohyoungkims.github.io/KPCSTL-Jubo/

## Deployment

The `Deploy GitHub Pages` workflow runs on `main` and can be dispatched manually. It runs the Node test suite, builds `.pages/`, and deploys through GitHub's Pages artifact API. The artifact contains only browser assets, not the server, credentials, repository archive, or reference research documents.

Build locally with `pnpm run build:pages`. Serve `.pages/` with a static HTTP server. Both `/KPCSTL-Jubo/` and `/KPCSTL-Jubo/studio.html` open the same workspace and storage key. Hash navigation stays within the project path.

## Storage and scope

This edition uses one path-scoped browser storage key. It preserves a local display name, current dated issues, change history, task status, and immutable finalized snapshots. Every save checks the current version and acknowledges success only after the entire browser write succeeds. Web Locks coordinate concurrent tabs when available. A full local backup is included as `pagesBackup` in JSON exports; there is no uploaded-backup restore UI yet.

No shared backend, login, or online database is configured. People and devices have independent copies. The visible banner, save indicators, name dialog, guide, preview, and archive explain this. The link-copy action shares the app, not the local content. Do not use local names or timestamps as authenticated identity evidence.

The original server-backed mode is retained. `frontend/pages-bootstrap.mjs` installs the local adapter only in the Pages artifact. `scripts/build-pages.mjs` generates the browser domain module from `lib/team-domain.mjs`, replacing only its CommonJS core import with the already-loaded browser core. Both modes use the same edit and finalization rules.

## Verification

The 64-test suite covers the existing shared backend and PDF behavior plus 14 browser-storage cases: reload persistence, device/path isolation, stale writes, concurrent commands, storage failures, idempotence, finalized snapshots, archive preservation, profile continuity, corruption, and defensive copying. Local browser checks confirmed name entry, editing, saving across reload, and four-page PDF preview under the repository subpath.
