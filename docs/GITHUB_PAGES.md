# GitHub Pages deployment

Share one address: [KPCSTL 주보 스튜디오](https://dohyoungkims.github.io/KPCSTL-Jubo/).

## Current access mode

The owner explicitly selected passwordless editing on October 24, 2026. The root opens the shared online editor immediately. Anyone with the address can read and change drafts; there is no invitation, password, or three-person access limit. Changes use the common **주보 편집팀** identity, so they are not attributed to individual people. Administrator access remains separately authenticated.

| Address | Current behavior |
| --- | --- |
| `/KPCSTL-Jubo/` | Shared editor; no sign-in required |
| `/KPCSTL-Jubo/?view=published` | Finalized bulletin reader inside the same app |
| `/KPCSTL-Jubo/studio.html` | Compatible editor entry for existing links |

All Share actions copy the clean root address. The finalized view shows only printable snapshots, but it is not a privacy boundary: anyone can return to the open editor and read drafts/history. Changes after finalization keep the previous final snapshot until the next finalization.

`frontend/cloud-config.mjs` supplies the public `apiBaseUrl` and `openEditing` setting. The Worker independently requires `OPEN_EDITING="true"` and an active non-admin `SHARED_EDITOR_ID`. The browser never contains a shared credential. Invalid bearer tokens do not bypass authentication; administrator APIs never accept the common identity. Disabling public editing requires changing both the Worker and frontend settings and redeploying.

## Build and publish

The `Deploy GitHub Pages` workflow runs on pushes to `main`, tests the project, builds `.pages/`, and deploys the frontend. Deploy the Cloudflare Worker separately before publishing dependent frontend changes.

Run `pnpm run build:pages` locally. `KPCSTL_API_BASE_URL` can override the API origin for testing. The generated release directory pins scripts, transitive modules, CSS, PDF workers, fonts and images to one content hash. An older open page may need a refresh after a subsequent deployment.

Only public configuration belongs in source. Never publish administrator invitations, bearer tokens, Cloudflare credentials, local backups, or database exports. The artifact contains browser assets only.

Verify a fresh anonymous visit to the exact root URL, shared edits in both directions between independent browsers, conflict handling, administrator rejection, and PDF preview. A passing build alone does not establish live behavior.

## Existing data and other modes

Browser-local keys remain intact: `kpcstl.github-pages.v1:/KPCSTL-Jubo/` and legacy `kpcstl.bulletin.study.v1`. Explicit transfer is available from the guide, preserves originals, and never overwrites an existing online date.

With a cloud API and `openEditing: false`, the original invitation-based mode remains available: root is the finalized reader and `studio.html` is the private editor. With an empty API URL, both entries use browser-local storage; this does not download cloud data or erase it.

The original Sites server build and platform authentication remain separate. Standalone database migrations live under `worker/migrations/`, not `drizzle/`. See [Shared storage setup and use](SHARED_STORAGE.md).
