# Shared saving verification — 2026-10-24

## Automated and build checks

- 133 Node tests passed, including the existing 56-field/PDF boundary matrix and the new authentication, public projection, migration, conflict and session tests.
- Syntax checks, the original server build, GitHub Pages build and standalone Worker bundle passed.
- A separate review found and fixed inherited task-key mutation and assignment to an inaccessible coordinator. Regression tests cover both, administrator recovery and rejection of forged administrator claims.

## Browser verification with the local Worker

- Two path-isolated browser sessions logged in independently, saved Korean sermon text and a pastor name, and received the other session's changes.
- A named staff invitation logged in under the intended identity. Administrator invitation controls and logout are accessible through the mobile profile menu.
- All six sections could be completed; finalization displayed an explicit publication confirmation. The congregation reader then displayed the saved final.
- Later draft edits remained private while the previous final stayed public.
- Public PDF preview rendered all four pages with no browser console errors.
- Public and editor layouts had matching 330px client/scroll widths in narrow iframe viewports (no horizontal page overflow). Physical iPhone and Android devices were not used.
- PDF generation and preview were verified; a physical-device file download was not independently confirmed.

## Live Cloudflare API verification

Worker: `https://kpcstl-jubo-api.kpcstl-jubo.workers.dev`

Deployment version: `98e263be-2830-4574-95cf-60346f92b6a3`

Twelve live checks passed with normal TLS verification: health, exact CORS, anonymous access rejection, foreign-origin rejection, two sessions for one stable editor, saving in both directions, stale-write protection, draft exclusion from public results, and independent logout.

Only a temporary private fixture dated 2099-01-04 was created. Its issue and all three snapshots were removed using exact-ID/content guards; subsequent database counts confirmed zero remaining. Both test sessions were logged out. No fixture was finalized or made public.

The detailed sanitized report is retained locally at `output/cloud-live-api-qa.json` (ignored by Git). Invitation codes and session tokens are excluded from reports and repository files.
