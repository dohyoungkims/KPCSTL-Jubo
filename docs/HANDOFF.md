# KPCSTL collaboration handoff — v0.3

> Original handoff record. GitHub publication was subsequently authorized on October 24, 2026; see the repository README and `handoff/README.md` for the import record. The marked image mentioned below as `IMG_8075.jpeg` is bundled at `references/fixed-areas-markup.jpeg`. Earlier deployment and validation statements below are historical records.

## User intent

Build a polished Korean-first bulletin workspace for Korean Presbyterian Church of St. Louis (세인트루이스 한인장로교회). The pastor edits on a phone or desktop, colleagues work on assigned sections, a coordinator checks progress, and a final four-page PDF is distributed. Preserve previous Sundays and finalized revisions. Provide short progress updates while actively working.

The user marked constant areas in IMG_8075.jpeg: the service/meeting guide, staff information, volunteer headings and 1부/2부 row labels, and midweek headings and left labels. These are retained from the original PDF. Weekly dates, names, passages, announcements, questions and offering values remain editable. The source PDF has question numbers 1 and 5 only; do not invent missing questions.

## Completed collaboration flow

1. A signed-in visitor confirms a display name. Identity is the authenticated Site-specific user ID; names can change without rewriting historical attribution.
2. On an empty server, the current browser's prior issues are imported after name registration. Original localStorage is retained. Imports never replace an existing date.
3. The team view shows people, assigned sections, completion totals, update/completion times and a filterable activity/history timeline.
4. Each content write records before/after values with server-provided author and timestamp. A conditional version update and snapshot insertion run in one D1 batch.
5. Stale separate-field changes can rebase; same-field conflicts require explicit comparison. Reordered lists are matched by stable item IDs. Deleted items are not silently reused by index.
6. Completed sections reopen on later edits. Only the assigned person or coordinator can change completion status. Assignment changes are recorded.
7. The coordinator reviews the PDF, resolves requests, then confirms the exact observed server version. All six sections must be complete. A content change during confirmation prevents stale approval.
8. Final PDF exports carry the content revision. Earlier final snapshots can still be downloaded after corrections. Internal task history is not printed in the congregation PDF.

## Main technical files

Read README.md for commands. API: app/api/team/route.ts calls lib/team-service.mjs. Server domain rules: lib/team-domain.mjs. UI: frontend/app.js and team-client.js. PDF engine: frontend/print.js. Schema: db/schema.ts; initial SQL: drizzle/0000_easy_sharon_carter.sql. Keep applied migration history immutable.

`frontend/` is source. `public/` and `dist/` are generated. Node and pnpm are needed for development; vendor PDF libraries/fonts are already bundled. Python/PyMuPDF/fontTools are only needed to regenerate artwork/font assets.

## Identity and hosting boundary

Production currently relies on Sites dispatch authentication and access policy. The adapter reads `oai-authenticated-user-id`, optional email and optional encoded display name. On this host those headers are injected by the platform. Never trust these headers from an arbitrary public client when moving to another host. Replace the adapter with verified server-side sessions or a trusted authentication proxy before external deployment. Portable loopback development uses the starter's mock sign-in; it must never be enabled for public hosting.

D1 binding is DB. Runtime tables are members, issues and issue_versions. This is shared church data among authorized visitors, not separate personal notebooks. The current final coordinator can transfer that role to another registered member. New participants appear after signing in and registering their own name; copying a link alone does not authorize them.

The present workspace blocks external invitations. The user plans to transfer the project and asked not to spend time resolving that host restriction. No external invitations have been sent. Keep private authoring access distinct from future public bulletin reading links.

## Data transfer

Browser-local source key: kpcstl.bulletin.study.v1. It remains untouched. Pending unsaved shared edits are stored under a per-user/per-issue recovery key. Do not clear either during a migration.

Source ZIPs cannot include current browser edits or live database state automatically. Export the app's JSON backup for a data handoff. Existing imports preserve historical unattributed edits. Legacy free-text table entries are kept as migration notes and must be mapped/acknowledged before PDF export/finalization. If a server already contains that Sunday, import skips it instead of overwriting it.

A host migration needs the data as well as code, configuration and authentication setup. Back up D1 before applying future changes. The original Site ID in the manifest is metadata, not an access credential.

## Verification and remaining limits

Automated tests cover model behavior, generated PDF layout limits, actual SQLite-backed API operations, simultaneous clients, atomic rollback, attribution, progress and finalization, imports, and UI-controller event flows. A production build is required before handoff. These checks are not real-browser tests. The authoring environment had no supported browser-control tool; verify actual iPhone Safari, Android Chrome and desktop interaction after transfer, including downloads and Korean IME typing.

The two large constant PDF regions were compared against the original at 2× resolution and matched pixel-for-pixel. Dynamic text uses original font subsets when possible and a Hangul fallback otherwise; exact font fidelity for arbitrary new Korean text remains incomplete. AI prompt execution and congregation-facing public dated URLs remain future work. Seed content still contains simplified example data, so a real week's content needs pastor review.

## GitHub and continuation

Destination: https://github.com/dohyoungkims/KPCSTL-Jubo. No code has been pushed there from this session. Prior writes failed with 403 Resource not accessible by integration; the user deferred GitHub publication. A move to another agent does not itself grant GitHub permissions. When the user is ready, connect authorized repository write access and publish a reviewed commit/branch without overwriting unrelated work.

Live Site: https://kpcstl-bulletin-studio.claycorp.chatgpt.site. The code is prepared for continuation in Claude Cowork, Claude Code or Codex. Read the original PDF and marked-up image before changing fixed layout decisions. The initial design study is background research; this document supersedes its old feature-status descriptions.
