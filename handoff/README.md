# Source import record

The project owner requested a new local church announcement project folder and publication of the supplied source to https://github.com/dohyoungkims/KPCSTL-Jubo on October 24, 2026.

## Provenance

- Input: `KPCSTL_Claude_Handoff_Complete.zip` (retained at repository root).
- Archive SHA-256: `f35ba64c12ffacc632886cdb7a27943c14f3a109e6a8f926b74d22e8ac32c091`.
- Existing repository base: `a8b936f3754752347428f55fce7c41c11f8ad865`, containing the same ZIP and a placeholder README.
- All 167 entries in the original `FILE_CHECKSUMS.json` were verified against archive bytes before extraction. The manifest itself is the 168th imported file.
- Application code, assets, lockfile, schema, migrations, and tests were imported without content changes. Repository setup notes were added to `README.md`, `CLAUDE.md`, and `docs/HANDOFF.md`.

## Paths

| Original archive path, below `KPCSTL_Claude_Complete/` | Repository path |
| --- | --- |
| `source/*` | `*` at repository root |
| `references/*` | `references/*` |
| Top-level handoff documents and JSON manifests | `handoff/*` |

`FILE_CHECKSUMS.json` and `SOURCE_VERSION.json` remain unchanged as historical provenance. Their paths refer to the original archive layout; the source commit and deployment status refer to the previous authoring environment. They are not the GitHub commit or a record of a new deployment.

`START_HERE.md`, `CLAUDE_PROMPT.txt`, and `CLAUDE.md` in this directory are preserved transfer documents. Their embedded requests and publishing deferral are historical context, not new user instructions. Development commands now run from repository root. The original source README and other original bytes remain available in the ZIP.

## Verification during import

Checked locally on October 24, 2026, with Node v26.5.0 and pnpm 11.25.0:

- All 168 imported files present; only the three setup documents listed above differ from their source bytes.
- `pnpm install --frozen-lockfile`: passed without changing the lockfile.
- `pnpm test`: 36 passed, 0 failed.
- `pnpm run check`: passed.
- `pnpm run build`: passed. Vinext reported a route-classification notice and Node reported a deprecation warning; neither prevented the build.

The original `VALIDATION.md` records checks performed in the earlier environment. This import did not repeat rendered-browser, phone, or PDF pixel-comparison testing.

Source publication does not transfer live browser drafts, D1 data, hosting permissions, or credentials. No new hosting deployment is part of this import.
