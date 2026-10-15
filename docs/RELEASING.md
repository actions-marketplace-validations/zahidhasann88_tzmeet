# Verification, packaging and release

The repository is prepared as version **0.1.0**, but no npm publication, GitHub tag,
GitHub Release or public Pages deployment has been performed by this implementation.
Publishing is an intentional action by the project owner, not a build side effect.

## 1. Review the source

- Confirm the npm name `tzmeet` is available or controlled by your account. Do not assume this repository grants registry ownership.
- Set real repository/homepage/issue URLs in package metadata if appropriate; no invented repository URL is shipped.
- Review [CHANGELOG.md](../CHANGELOG.md), scoring/endpoint semantics and known limitations.
- Keep `package.json`, `packages/core/package.json`, `packages/cli/package.json` and `apps/web/package.json` versions consistent. Update `program.version()` in `packages/cli/src/cli.ts` as well when changing the CLI version. Update standalone README tarball examples as needed.
- If dependencies change, use pnpm to update `pnpm-lock.yaml`; do not hand-edit a frozen lockfile.
- Do not include `.env`, registry tokens, calendar data, or other credentials. Source archives should exclude `node_modules`, build outputs and test traces.

## 2. Verify a clean checkout

Requires Node 20+ and pnpm 10.18.3. CI tests Node 20/22/24; use a maintained LTS locally.

```sh
pnpm install --frozen-lockfile
pnpm --filter @tzmeet/web exec playwright install --with-deps chromium
pnpm verify
```

`verify` runs lint, typecheck, all Vitest tests, the full monorepo build,
desktop/mobile production static-export tests, and `check:package`. The package
check builds/packs the actual CLI, npm-installs it into a temporary prefix,
executes it from an unrelated directory, and deletes those temporary files.
Only commander is an external CLI runtime dependency. The shared core is bundled,
so no separate `@tzmeet/core` release is needed to publish the CLI.

GitHub workflow syntax can be checked independently (Docker required):

```sh
docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.7 -color
```

The workflows do this automatically. Vitest also checks workflow contracts and
version/license consistency. Hosted GitHub jobs themselves still require a real
repository and must be observed there; local checks are not proof of a hosted run.

## 3. Prepare artifacts

From the root:

```sh
mkdir -p release-artifacts
pnpm --dir packages/cli pack --pack-destination "$(pwd)/release-artifacts"
# Optional standalone library distribution:
pnpm --filter @tzmeet/core build
pnpm --dir packages/core pack --pack-destination "$(pwd)/release-artifacts"
```

Inspect the archive and package manifest. The CLI tarball must contain:

- `dist/bin.js` with a Node shebang and bin metadata;
- source map, MIT `LICENSE`, CLI `README.md`;
- `dist/THIRD_PARTY_NOTICES.txt` for bundled Luxon, adhan and zod;
- commander as its only runtime dependency, no runtime `workspace:*` reference.

For a final install check of the exact chosen tarball, use a fresh prefix or the
existing `pnpm check:package` helper. A local install is **not** a registry publish.

## 4. Deliberately publish npm (owner action only)

Authenticate with an npm account that controls `tzmeet`, following npm's current
2FA/authentication requirements. Review the exact prepared archive before executing
the publishing command. Do not commit authentication tokens.

```sh
npm login
# Replace VERSION with the prepared version; dry-run does not publish:
npm publish ./release-artifacts/tzmeet-VERSION.tgz --access public --dry-run
# Only after review, remove --dry-run to actually publish that archive.
```

This document intentionally does not run the non-dry-run command. Neither CI nor
the Pages workflow contains npm publishing credentials or a publication step.
If you also choose to publish the scoped library, separately confirm ownership of
`@tzmeet`, review `tzmeet-core-VERSION.tgz`, and publish it with public scope access.
Consumers of the CLI do not need that optional library release.

## 5. Deploy static Pages (repository-owner setup)

1. Commit the workflows/source to the repository's `main` branch.
2. Enable Actions; set **Settings → Pages → Source: GitHub Actions**.
3. Configure/approve the `github-pages` environment if your repository requires it.
4. Push `main` or manually dispatch the Pages workflow from `main`.
5. Confirm unit checks, the prefix-aware production browser checks and deployment
   all pass; open the environment's reported URL and round-trip a shared link.

The workflow reads the actual Pages `base_path` from metadata, so there is no
hardcoded account/repository URL. The build job has read-only site access and
cannot enable Pages using an elevated token. The deploy job receives only Pages
write and OIDC permissions after checks succeed. PRs do not deploy. To deploy
from a branch other than `main`, update both the trigger and ref guard.

For a local project-site gate matching the workflow:

```sh
TZMEET_BASE_PATH=/tzmeet pnpm --filter @tzmeet/web build
TZMEET_E2E_BASE_PATH=/tzmeet TZMEET_E2E_SKIP_BUILD=1 pnpm test:e2e
```

The second command serves and tests the existing `out/` files without rebuilding
or changing their base path. Only those files are uploaded by the workflow. For
root hosting leave the base path empty. Configure custom-domain DNS/Pages settings
outside this app; no application server needs to be deployed.

## 6. Record the release

After a real release/deployment, record its version/date and URLs in your release
notes, optionally tag the verified commit, and open a new Unreleased changelog
section. Distinguish local preparation from actual registry/hosted publication.
No git tag is automatically created by these scripts.
