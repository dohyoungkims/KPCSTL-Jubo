# KPCSTL Jubo / 주보 스튜디오

A Korean-first church bulletin editor for desktop and mobile. Version 0.3 adds persistent shared editing, named change history, per-section assignments and completion, and coordinator-approved PDF exports.

## Repository setup — October 24, 2026

The complete supplied handoff has been unpacked into this repository. Run development commands from this folder: the archive's `source/` directory is now the repository root. Reference documents are in `references/`; original transfer notes and checksums are preserved in `handoff/`. See [handoff/README.md](handoff/README.md) for provenance and validation details.

GitHub publication was authorized on October 24, 2026. Statements in the original handoff that publication was deferred describe its earlier state. Publishing source to GitHub does not deploy a new website or transfer the existing Site's authentication, access permissions, or database.

## Implemented

- A display name associated with each signed-in person; initials and names in the UI.
- Shared dated issues stored in Cloudflare D1. Every successful change stores an immutable snapshot.
- Before/after content history, actor and server timestamp, comments, change requests and activity records.
- Six assigned sections with start/progress/completed states. Editing completed content reopens its section.
- Coordinator-only finalization after all sections are complete and requests resolved. Earlier finalized snapshots remain downloadable after later corrections.
- Compare-and-set updates, stable-ID rebase for reordered list items, explicit same-field conflict resolution, and local recovery of unsaved inputs.
- Previous Sunday preservation, new-week duplication, year/month/search archive and JSON backup.
- Four-page Letter PDF export and an actual PDF.js preview of the same bytes. Overflow and unsupported characters block export.
- The original fixed service schedule and staff directory are retained verbatim. Volunteer and midweek table headings/row labels stay fixed; values use structured inputs.
- Automatic legacy browser import only when shared storage is empty; existing Sundays are never overwritten by imports. Legacy records remain unattributed, and unmapped free text is preserved for review.

AI execution and public congregation issue links are not connected. Access to the authoring site is governed by hosting permissions. Entering a name or copying a link does not grant a new person access.

## Run locally

Node 22.13 or newer and pnpm are required. Dependencies are locked in pnpm-lock.yaml. Installed packages and secrets are excluded from source.

```sh
pnpm install --frozen-lockfile
pnpm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_easy_sharon_carter.sql
pnpm run dev
```

Apply a migration only once per local database. Open the loopback URL printed by the dev command. The portable starter provides development-only sign-in through `/signin-with-chatgpt?return_to=/studio.html`. See `docs/HANDOFF.md` for the identity boundary and migration notes. Do not expose a local mock-auth server publicly.

```sh
pnpm test
pnpm run check
```

The UI source lives in `frontend/`; `scripts/prepare-frontend.mjs` copies it into generated public assets before dev/build. `dist/` and `public/` are generated output. Do not edit generated output as source.

## Validation

Tests exercise core bulletin operations, PDF creation/overflow, authentication, actor attribution, concurrent writes, atomic snapshots, idempotence, progress reopening, coordinator approval, archive preservation, legacy imports, rebase/deletion handling, and UI controller flows. Controller tests use a minimal DOM boundary and do not replace real-browser testing.

The service-guide and staff-directory regions in the generated PDF were compared to the supplied original at 2× resolution with zero pixel difference. Table-value edits were verified by text extraction, and output pages were rendered for inspection. New glyphs may still use a fallback font; obtain the full licensed original fonts for complete typography fidelity. Actual iPhone/Android/desktop browser interactions could not be tested in the authoring environment.

## Architecture

- `frontend/core.js`: bulletin model and immutable content operations.
- `frontend/app.js`, `team-client.js`, `styles.css`: responsive UI, sync, conflicts and progress.
- `frontend/print.js`, `print-view.js`: PDF generation and preview.
- `lib/team-domain.mjs`: server-side author attribution, tasks, approval and validation.
- `lib/team-service.mjs`, `app/api/team/route.ts`: authenticated shared API.
- `db/schema.ts`, `drizzle/`: D1 schema and migration history.
- `scripts/prepare-fixed-template.py`: retains the user-selected fixed source PDF regions.
- `frontend/assets/`: original church PDF, fixed reference crops, fonts and print assets.
- `test/`: automated domain, API, concurrency, PDF and controller tests.

The original PDF and church contact details were supplied by the project owner, who authorized their inclusion because they are already public church information. The public congregation PDF does not include internal collaborator activity or progress.

## Hosting and transfer

The existing Sites identity is retained in the hosting manifest. Source files alone do not transfer host credentials, user access or the D1 database. This app requires a server and database; GitHub Pages by itself cannot host the shared API. Outside Sites, replace the dispatch-identity adapter with verified sessions and provision a compatible persistent database before publishing. See `docs/HANDOFF.md`.
