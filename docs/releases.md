# Checks, packages and releases

Two different questions are answered separately:

| Question | Answered by | Status is claimed by |
| --- | --- | --- |
| Is the source consistent, and does the packaged plugin run on plain Node? | CI (`.github/workflows/ci.yml`) | A green CI run on that exact commit |
| Does the plugin install and work in the Codex or Claude Code desktop apps? | A person, on a disposable profile | The tester's own notes. CI does not do this and a release never implies it |

## What CI checks

Pull requests and pushes to `main` run on Node 22 and 24 (Ubuntu) and Node 22 (macOS). Windows is not covered.

1. `node scripts/check.mjs`: every server, runtime and script file parses; `package.json`, the lockfile, both plugin manifests, the bundled skills, `server/runtime.mjs`, `runtime/home.js`, `runtime/native-host.js` and `runtime/native.js` carry one version; every file in `EDITOR_FILES` exists and everything the pages and modules load is listed; the licences and notices exist; the MCP manifests point at a real server.
2. `node --test "tests/*.mjs"`, which uses Node's built-in runner and needs no install:
   - a disposable Paper is created, read, saved, reopened, refused when saved from a stale revision, exported as a bundle, and imported;
   - the source tree answers MCP `initialize`, `tools/list` and a create/save/read round trip;
   - the archive is built from the commit, rebuilt to prove it is identical, unpacked **without `node_modules`**, checked again, started **through a symlink**, and driven over MCP (create, save, read, stale-save refusal).
3. `node scripts/verify-assets.mjs` after `npm ci` and `npm ci --prefix vendor/inspection`: the toolbar and native bundles are rebuilt from the pinned lockfiles and must match the committed `runtime/inspection.js`, `runtime/native.js` and cache-busting hashes byte for byte. If it fails, run `npm run build:inspection && npm run build:ui` and commit the result.
4. The pull request's archive is attached to the run as the `openpaperdesign-package` artifact, with its checksum, for isolated testing.

Every test uses a temporary folder with `HOME`, `PAPER_HOME` and `TMPDIR` redirected. No real Papers, profile or installed plugin are touched.

Run the same locally: `npm run check && npm test`, and `npm ci && npm ci --prefix vendor/inspection && npm run verify:assets` on a clean tree. The package test needs `git` and `unzip`, and packages `HEAD`: commit before running it if you want it to see your changes.

## The package

`node scripts/package.mjs` writes `dist/openpaperdesign-<version>.zip` and `.zip.sha256` (add `--ref <commit>` for another commit, `--out <dir>` to choose where, `--tag vX` to assert the version).

- It packs committed files from an exact Git commit, never the working folder. The exact allowlist is `ALLOW` in `scripts/package.mjs`, including the shipped release guide, project design guide, lockfile and marketplace metadata. Papers, credentials, tests, fixtures and `node_modules` are not on it, and a deny-list stops them if they were ever committed under an allowed folder.
- Entries are sorted, stored without compression and stamped with the commit time, so the same commit gives the same bytes on any machine. The SHA256 identifies the archive.
- `PACKAGE-INFO.json` inside the archive, and the ZIP comment, name the source commit.
- Users need only Node.js 22 or later: unpack, then `node <folder>/server/server.mjs`. `node <folder>/scripts/check.mjs` and `node <folder>/scripts/smoke.mjs <folder>` verify an unpacked copy; neither needs `npm install`.

Verify a download: `shasum -a 256 -c openpaperdesign-<version>.zip.sha256` (Linux: `sha256sum -c`).

## Releasing

1. Bump the version everywhere it appears and rebuild: `npm run build:inspection && npm run build:ui`, then `npm run check`. Merge to `main`.
2. Create a tag `v<version>` on the commit to release. The version in `package.json` must equal the tag, for example `0.7.0-preview.13` ↔ `v0.7.0-preview.13`.
3. What happens next (`.github/workflows/release.yml`):
   - **Preview tag** (contains `-`, such as `v0.7.0-preview.13`): pushing it builds the exact tag commit, runs the checks, tests and asset rebuild, packages it, and publishes a GitHub **prerelease** with the archive, checksum and a short note.
   - **Stable tag** (such as `v0.7.0`): pushing it only verifies and packages. To publish, open Actions → Release → Run workflow, enter the tag twice, and approve the `release` environment if you have set required reviewers on it (Settings → Environments → release; recommended). Stable releases must be on `main`.
   - The publish job is the only one with write access. It re-checks the checksum and that the tag still points at the tested commit, and refuses to replace an existing release.

Nothing publishes on ordinary pushes or pull requests, and no step creates a tag.

The workflows pin every action to a full commit hash with its release tag in a comment. Update them deliberately: look up the tag with `gh api repos/<owner>/<action>/git/ref/tags/<tag>` (resolve annotated tags once more through `git/tags/<sha>`) and change hash and comment together. `tests/workflow-files.mjs` fails on an unpinned action.

## Native install acceptance

Passing CI says the files are consistent and the server runs from an unpacked folder. It does not say the Codex or Claude Code apps accept the plugin. Before relying on a release there, a tester should use a throwaway profile or machine, install from the archive or the tagged revision with the host's own plugin mechanism, restart the host, and record whether Home opens, the MCP tools are listed, and a Paper can be created, edited in the canvas and saved. Record the host version and date; report what was not tried. This repository does not claim those flows unless that record exists.
