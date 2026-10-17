# Standalone bundle

The `standalone` branch builds the plugin into a folder that runs without network access, package installs or builds. It needs only Node.js 22 or newer, Python 3, git and bash on the machine.

## What differs from upstream

- The skills never run `pnpm`, `npm` or `npx`, and they never download the viewer from a GitHub release.
- `/understand-dashboard` starts the prebuilt viewer from `packages/viewer/`.
- The dashboard uses bundled fonts instead of Google Fonts.
- The bundle ships `packages/core/dist`, the built dashboard and the production `node_modules` from `understand-anything-plugin/pnpm-lock.yaml`, with no symlinks.

## Build

`.github/workflows/standalone.yml` builds the bundle on every push to `standalone` and runs a smoke test on Linux, Windows and macOS. On Linux the smoke test has no network. A tag `standalone-v<version>-<n>` also publishes a GitHub release with the archives, `SHA256SUMS` and a build provenance attestation.

## Install

1. Download one release archive and `SHA256SUMS`, then check them: `sha256sum -c --ignore-missing SHA256SUMS` (on macOS `shasum -a 256 -c --ignore-missing SHA256SUMS`) and `gh attestation verify <archive> --repo ihor-drachuk/Understand-Anything`.
2. Extract `understand-anything-plugin/` into a local marketplace directory and add `{ "name": "understand-anything", "source": "./understand-anything-plugin" }` to the `plugins` array of that marketplace's `marketplace.json`.
3. Run `claude plugin install understand-anything@<marketplace-name>`.

To check an installed copy, run `sha256sum -c SHA256SUMS` inside `understand-anything-plugin/`. `BUILD-INFO.json` names the upstream commit, the build commit and the workflow run.

## Update to a newer upstream

Review the upstream diff first, especially `hooks/`, `skills/**/SKILL.md`, `agents/`, the lockfiles and the vendored `.wasm` grammars, for new network access, package installs or dependency changes. Then rebase `standalone` onto the reviewed commit, set `UPSTREAM_BASE` in the workflow to it, push, and push a new `standalone-v*` tag to publish a release.
