# GitHub Pages deployment

Church members keep the same address: [KPCSTL 주일 주보](https://dohyoungkims.github.io/KPCSTL-Jubo/).

## Two storage modes

`frontend/cloud-config.mjs` selects the Pages behavior. An empty `apiBaseUrl` keeps the original browser-local editor. A configured Cloudflare Worker origin enables the shared application:

| Address | Shared mode |
| --- | --- |
| `/KPCSTL-Jubo/` | Public reader containing finalized bulletins only; no login required |
| `/KPCSTL-Jubo/studio.html` | Private editor; requires a personal invitation code |

The public page does not read browser-local drafts or private team data. Saving an edit shares it with authenticated editors. Publishing it to church members requires finalization. The previous finalized bulletin stays public while its replacement is edited.

See [Shared storage setup and use](SHARED_STORAGE.md) for the Cloudflare deployment, editor invitations, migration, and backups. A configured URL alone is not evidence that the live backend or Pages deployment has passed verification.

## Build and publish

The `Deploy GitHub Pages` workflow in `.github/workflows/pages.yml` runs on `main` and can also be dispatched manually. It runs the Node test suite, builds `.pages/`, and deploys through GitHub's Pages artifact API. It deploys the frontend only; Cloudflare Worker code and database migrations have a separate deployment.

Build locally with `pnpm run build:pages`, then serve `.pages/` with a static HTTP server. `KPCSTL_API_BASE_URL` can override the public API origin for a local build. The committed `frontend/cloud-config.mjs` supplies the origin to the GitHub workflow. Only that public origin belongs in the file; invitation codes, bearer tokens and Cloudflare credentials do not.

The artifact contains browser assets, including the PDF template and fonts. It excludes server code, local secret files, database backups, repository archives and research documents. Hash navigation and relative links remain within the repository path.

For a shared release, deploy and verify the Worker first, then publish the Pages build pointing to it. Verify the public root, protected editor, two independent editor sessions, draft privacy, finalized publication and PDF output on the deployed URLs. A successful build is not a substitute for these live checks.

## Existing local data

Browser-local mode uses `kpcstl.github-pages.v1:/KPCSTL-Jubo/`. The legacy draft key is `kpcstl.bulletin.study.v1`. Shared mode offers an explicit transfer from these sources after editor login. It preserves both originals and never overwrites an online issue with the same date. See the migration section of [SHARED_STORAGE.md](SHARED_STORAGE.md).

When `apiBaseUrl` is empty, `/` and `/studio.html` still open the same browser-local workspace. Local names and timestamps are not authenticated identities. Local exports contain a `pagesBackup`; an uploaded-backup restore interface is not provided. Switching back to local mode does not download cloud edits or erase the database—it opens that device's separate local data.

## Original server mode

The original Sites server build remains separate and retains its platform authentication. The Pages build replaces `app.js` with `pages-bootstrap.mjs`; the normal server build does not. The standalone Worker supplies verified identities to the shared service rather than trusting client-supplied platform headers.

`scripts/build-pages.mjs` also generates `team-domain.browser.mjs` from the shared domain source for local mode. Do not modify generated `.pages/` files or reuse the original Sites database migrations for the standalone Worker.
