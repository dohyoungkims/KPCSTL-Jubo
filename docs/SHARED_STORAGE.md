# Shared bulletin storage

The GitHub Pages frontend uses a Cloudflare Worker and D1 database for shared saving. The API is at `https://kpcstl-jubo-api.kpcstl-jubo.workers.dev`; see [verification results](SHARED-QA.md). This document also describes redeployment and recovery.

## Using the app

- **Church members:** open [the public bulletin](https://dohyoungkims.github.io/KPCSTL-Jubo/). No account is needed. Choose a date, read the bulletin, or use **인쇄 미리보기 / PDF 저장**. An empty database shows “아직 공개된 주보가 없습니다.”
- **Editors:** open [the editor](https://dohyoungkims.github.io/KPCSTL-Jubo/studio.html) with a personal invitation link or enter the invitation code. Each editor should receive a separate named invitation. The ordinary public link contains no editor access.
- **Administrator:** open the profile menu and choose **편집자 초대** to create a named editor link or revoke access. Copy a newly created link before closing its dialog; the server keeps only its hash and cannot show the code again.

Text changes are sent about 700 ms after typing pauses, including after Korean text composition finishes. Wait for **공유 저장 완료** before assuming another device has the change. An open editor checks for other editors' changes about every eight seconds when visible and idle; it avoids replacing an active input, an open dialog, pending edits or a conflict review. Concurrent changes use version checks. Conflicting text requires comparison instead of silent overwriting.

Unsaved text has a recovery copy on that device. A network failure does not mean it reached the server. Reconnect and check the save indicator. Editor sessions and recovery copies are scoped to the backend and project.

## Publishing to church members

Complete all six task areas, resolve outstanding change requests, and review the PDF for layout warnings. The issue's final coordinator chooses **확정하고 PDF 받기**. In shared mode, the confirmation explicitly states that this publishes the bulletin to the public link.

The public reader checks for updated finalized snapshots about every 30 seconds while visible, and on returning to the tab. It preserves the reader's selected archive date. This is periodic synchronization, so updates are not instantaneous. Public responses contain only printable content; team members, task state, comments, requests and edit history remain private. Editing a published issue creates a new draft while its previous finalized snapshot remains public until the next finalization.

The administrator can reassign a coordinator, including recovery when a former coordinator's access has expired. Administrator access alone does not permit finalization: the administrator must first be the issue's coordinator. Reassign all issues held by an editor before revoking that editor's access. Revoked or expired editors cannot receive new assignments.

## Bringing existing browser work online

On first editor login, the app offers eligible drafts from that browser. Select the issues to transfer, or deliberately start with an example. Imported issues enter the online archive as drafts and must be reviewed before publication.

- The original `kpcstl.github-pages.v1:/KPCSTL-Jubo/` and `kpcstl.bulletin.study.v1` data stays intact. Pages drafts take precedence when both sources contain the same date.
- An existing online issue with the same date is never overwritten. Compare it with the original local copy or backup and manually copy any needed content into the online editor.
- Partial transfers can be retried; already imported dates are skipped. **이 기기의 이전 주보 가져오기** in the guide can reopen the transfer flow after it was skipped.
- Another device's local drafts are not discoverable from this browser. Open the editor on the device where those drafts were entered to transfer them.

## Deployment

Use the project root. The standalone configuration is `wrangler.shared.jsonc`; its D1 binding is `DB`, its database name is `kpcstl-jubo`, and migrations are under `worker/migrations/`. The church database created for this setup has ID `5c6ea52e-a03f-4e8c-b64f-b63027e7f33b`. Verify the configuration targets this database before remote operations. Keep `FRONTEND_ORIGIN` set to `https://dohyoungkims.github.io` for production; it is an origin, without the repository path.

1. Install the repository dependencies, then authorize Wrangler with the account that owns the church database. Account sign-up and authorization are completed by the account owner.

   ```sh
   pnpm exec wrangler login
   pnpm exec wrangler whoami
   ```

2. Apply the standalone migrations and deploy the API. For a different installation, create its own D1 database and update its ID first. Do not recreate the existing church database.

   ```sh
   pnpm exec wrangler d1 migrations apply kpcstl-jubo --remote --config wrangler.shared.jsonc
   pnpm exec wrangler deploy --config wrangler.shared.jsonc
   ```

3. Bootstrap the first administrator once. This creates a private JSON file containing the invitation code and a SQL file containing only the hash. The command prints file paths, not the code.

   ```sh
   node scripts/manage-access.mjs --name "Administrator display name"
   ```

   Apply the exact SQL path printed by that command:

   ```sh
   pnpm exec wrangler d1 execute kpcstl-jubo --remote --config wrangler.shared.jsonc --file "work/access/GENERATED-ADMIN-FILE.sql"
   ```

   `work/access/` is ignored by Git, has directory permissions `0700`, and its generated files use `0600`. Keep the JSON file private. Open the editor and enter its code, or construct the private editor URL with `#invite=CODE`. Do not put codes in query parameters, repository files, screenshots, logs or the public bulletin link. Additional normal editors are invited through the administrator UI.

4. Verify the Worker URL returned by deployment. `/health` should respond successfully, `/api/public` should return an empty archive before publication, and `/api/team` must reject unauthenticated access. Test two independent authenticated editor sessions and a finalized public snapshot.

5. Put only the verified Worker origin in `frontend/cloud-config.mjs`, run the repository tests and `pnpm run build:pages`, then publish through the GitHub Pages workflow. The frontend and Worker deploy independently. Verify the deployed GitHub URLs again; see [GITHUB_PAGES.md](GITHUB_PAGES.md).

The original Sites configuration, routes and `drizzle/` migrations remain separate. No Cloudflare account token or administrator invitation is needed in the public Pages build.

## Access lifetime and recovery

Personal invitation codes last one year and can be reused on additional devices until revoked or expired. Each login creates a separate session lasting at most 30 days, capped by the invitation's expiry. Logout ends that device's session; revocation ends all sessions for that editor and disables their code. The editor identity belongs to the invitation, so sharing an invitation also shares its identity and permissions.

If all administrator access expires or is lost, the Cloudflare account owner can use the bootstrap procedure to add a new administrator. That administrator can recover coordinator assignments. Keep access files and database exports in protected storage. Browser session tokens are stored locally to support persistent login; use trusted devices for editing.

## Backup and cost

Before schema changes, export the remote database to a private location. Use a unique filename rather than replacing a previous backup:

```sh
umask 077
mkdir -p work/backups
pnpm exec wrangler d1 export kpcstl-jubo --remote --config wrangler.shared.jsonc --output work/backups/kpcstl-jubo-YYYY-MM-DD.sql
```

The export includes drafts, history, access hashes and finalized snapshots. `work/` is excluded from Git, but also keep a protected copy outside this checkout. The frontend's JSON export is useful for issue content; it is not a replacement for a full D1 backup. Never restore an unreviewed export over the live database.

Normal church bulletin use is expected to fit the free plan, but usage and future pricing are not guaranteed. As checked on October 25, 2026, D1's free allowance includes five million rows read per day, 100,000 rows written per day and 5 GB total storage. Reaching a free limit blocks the relevant operations; it does not automatically upgrade the account. Workers has its own limits, and archive polling consumes requests and database reads. Monitor usage in Cloudflare before choosing any paid plan. [Official D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) · [Official Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/).
