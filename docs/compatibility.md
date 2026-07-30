# OpenCode Compatibility

This document records the strongest compatibility claim the project makes.
`package.json` defines where the plugin can be installed and tried; the matrix
below defines the combinations continuously tested or historically
guaranteed.

## Compatibility Matrix

| OpenCode line | Runtime versions checked | Latest guaranteed plugin version | Status |
| --- | --- | --- | --- |
| `1.18.x` from `1.18.7` | Exact `1.18.7` and latest stable `1.18.x` | `0.1.0` | Rolling nightly |

There are no archived OpenCode lines yet. When a line leaves the rolling
window, its row remains in this table, its status changes to **Archived**, and
the latest plugin version that passed before removal is frozen in **Latest
guaranteed plugin version**.

Newer plugin versions may still work on an archived OpenCode line and users are
welcome to try them. The guarantee for that OpenCode line stops at the version
recorded in the matrix.

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

1. find the newest released plugin version whose CI passed on that OpenCode
   line;
2. keep or add the line in the compatibility matrix;
3. record that exact plugin version as the latest guaranteed version;
4. change its status to **Archived**;
5. add the new rolling line and update the changelog in the next release.

Example of an archived row:

| OpenCode line | Runtime versions checked | Latest guaranteed plugin version | Status |
| --- | --- | --- | --- |
| `1.18.x` from `1.18.7` | Through `1.18.12` | `0.4.2` | Archived |

The exact archived numbers must come from a successful workflow run and a
published plugin release; do not infer them from semver alone.

For every plugin release, update the active rows to that exact version only
after the rolling workflow has passed. The documentation contract test binds
the active matrix to `package.json` so a release version bump cannot leave the
guarantee stale.

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
