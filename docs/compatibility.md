# OpenCode Compatibility

This document records the strongest compatibility claim the project makes.
`package.json` defines where the plugin can be installed and tried; the matrix
below is the historical record of exact version combinations that passed the
real integration suite.

## Compatibility Matrix

| OpenCode version | Latest `opencode-model-dispatch` release tested | Verification | Status |
| --- | --- | --- | --- |
| `1.18.7` | `0.1.0` | Real dispatch and same-agent FIFO | Rolling minimum |
| `1.18.9` | `0.1.0` | Real dispatch and same-agent FIFO | Archived |
| `1.18.10` | `0.1.0` | Real dispatch and same-agent FIFO | Rolling minor latest |

Every exact OpenCode version that passes against a release is kept in this
table. Rows are never removed merely because the rolling window moves. When a
runtime version is no longer tested, its status changes to **Archived** and its
latest tested plugin release stays unchanged. If that exact runtime is tested
successfully against a later plugin release, update the existing row.

Newer plugin versions may still work on an archived OpenCode version and users
are welcome to try them. The guarantee for that OpenCode version stops at the
plugin release recorded in the matrix. An OpenCode version absent from the
table has no tested compatibility guarantee.

## Rolling Verification Window

The
[OpenCode compatibility workflow](../.github/workflows/compatibility.yml)
runs every night and can also be started manually. It covers the current
supported OpenCode minor line and the five previous lines. For each line it
installs the latest stable patch and runs the real integration suite.

While the declared minimum belongs to the rolling window, its exact version is
also tested. For example, the `1.18.x` line currently tests both the exact
minimum `1.18.7` and the latest published `1.18.x` patch. If those are the same
release, the workflow runs it only once.

The resolver:

1. reads `engines.opencode` from `package.json`;
2. fetches the published `opencode-ai` version list from npm;
3. groups matching stable releases into `major.minor.x` lines;
4. keeps the current line plus its five predecessors and selects the latest
   patch in each;
5. adds the exact declared minimum while its line remains active.

The implementation is in
[`scripts/resolve-opencode-compatibility.ts`](../scripts/resolve-opencode-compatibility.ts).
It accepts only the explicit `>=x.y.z <N` policy form and stable numeric
versions. Prereleases are excluded. Malformed registry data, a missing minimum
release, or an empty supported range fails closed.

A new major version is also excluded until its API and behavior have been
reviewed and the declared range is deliberately updated.

After a new major has been reviewed and added to the declared range, the same
window continues across the boundary. The final minor line from the previous
major remains active through new-major minor `4` and is archived when minor `5`
becomes current. For example, the latest `1.x` line remains tested alongside
`2.0` through `2.4`, then leaves the window when `2.5` is published.

## Retiring a Minor Line

The workflow is intentionally read-only and does not silently rewrite the
compatibility promise. When a minor line becomes more than five lines older
than the current line and leaves the nightly matrix:

1. find every exact OpenCode version from that line already recorded in the
   compatibility matrix;
2. keep each row and its latest tested plugin release unchanged;
3. change the rows' status to **Archived**;
4. append newly tested exact OpenCode versions from the incoming rolling line;
5. update the changelog in the next release.

Example of an archived row:

| OpenCode version | Latest `opencode-model-dispatch` release tested | Verification | Status |
| --- | --- | --- | --- |
| `1.18.12` | `0.4.2` | Real dispatch and same-agent FIFO | Archived |

The exact archived numbers must come from a successful workflow run and a
published plugin release; do not infer them from semver alone.

For every plugin release, update every exact runtime row that passed the rolling
workflow to that plugin version. Append a row when the workflow tests a runtime
version not previously recorded. Do this only after the workflow has passed.
The documentation contract test binds the active matrix rows to `package.json`
so a release version bump cannot leave the guarantee stale.

## What the Integration Proves

The compatibility job starts a real OpenCode server with a local deterministic
model provider. It verifies the runtime contracts this plugin depends on:

- `tool.execute.before` interception without replacing the built-in `task`;
- provider, model, agent, session, and message data exposed by the supported
  SDK;
- child-message model and effort selection;
- task metadata and child-session model persistence;
- FIFO correlation for concurrent calls to the same parent agent.

No external model provider is contacted. Normal CI and the release workflow
separately verify the installed npm package and native picker artifacts.

## Changing the Declared Range

When raising the minimum or adding a new OpenCode major:

1. update `engines.opencode` and the `@opencode-ai/plugin` peer range together;
2. update the pinned plugin and SDK development dependencies and `bun.lock`;
3. review the SDK adapters and hook timing described in
   [architecture](architecture.md);
4. run the focused contract, installed-package, and real OpenCode tests from
   the [development guide](development.md#update-the-opencode-sdk-contract);
5. update this matrix and the changelog in the same release.

Do not retroactively broaden an already published package based only on a
green latest-version run. A new major requires an explicit review and a new
plugin release.
