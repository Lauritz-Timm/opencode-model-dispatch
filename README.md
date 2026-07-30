# opencode-model-dispatch

OpenCode plugin that pauses built-in `task` dispatches, batches calls started
close together, and opens a native model picker before subagents run.

This is an independent community project. It is not affiliated with, sponsored
by, or endorsed by OpenCode or Anomaly.

## Status

Version `0.1.0` is the initial supported release line. The implementation, npm
packaging, real OpenCode dispatch path, and native picker protocol are
automated release gates. Every publication remains fail-closed until the TUI
and Desktop checklist in `docs/manual-integration-gate.md` is completed with
release evidence for that source revision.

## Install

The package targets OpenCode `>=1.18.7 <2`. Add it to OpenCode configuration:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-model-dispatch"]
}
```

OpenCode installs configured npm plugins with Bun. No Rust or Tauri toolchain is required,
and no separate `npm install` is needed. The npm tarball contains the plugin
JavaScript and its supported native picker binaries; install lifecycle scripts
are not used.

Bundled picker targets:

| Operating system | CPU | Asset | Status |
| --- | --- | --- | --- |
| Linux (glibc; Ubuntu 22.04 build baseline) | x64 | `picker-linux-x64` | Supported |
| Linux (glibc; Ubuntu 22.04 build baseline) | ARM64 | `picker-linux-arm64` | Supported |
| macOS | Apple Silicon (ARM64) | `picker-macos-arm64` | Supported |
| Windows 10/11 | x64 | `picker-windows-x64.exe` | Supported |
| Windows 11 | ARM64 | `picker-windows-arm64.exe` | Supported |

Other targets fail with a clear error. Set `OPENCODE_MODEL_DISPATCH_PICKER` to
an absolute compatible picker path to use a custom build.

The expected picker release asset name is
`picker-${platform}-${arch}${ext}`. The same binaries are attached to:

`https://github.com/Lauritz-Timm/opencode-model-dispatch/releases/download/v${version}/picker-${platform}-${arch}${ext}`

The Linux artifacts are dynamically linked and require a glibc-based
distribution with the WebKitGTK 4.1/GTK runtime libraries used by Tauri; they
are not Alpine/musl binaries. They are built and tested on Ubuntu 22.04.
Windows uses WebView2, and macOS uses the system WebKit runtime. Release binaries are
Developer ID signed and notarized on macOS and Authenticode signed on Windows
before they are uploaded.

The package is ESM-only and supports Node.js 18 or newer. The installed
`opencode-model-dispatch-picker` executable is a low-level NDJSON-RPC bridge
for OpenCode/package diagnostics, not a standalone interactive CLI; normal use
is through the plugin entry in OpenCode configuration.

## Configuration

Dispatch is opt-in. First-run setup and the `configure_model_dispatch` tool
write:

- global settings to `~/.config/opencode/model-dispatch.json`;
- optional project dispatch settings to `.opencode/model-dispatch.json`;
- optional project config exclusion to `.gitignore`.

The settings UI controls dispatch enablement, the batching window, picker
timeout, global privacy-safe logging, global/project scope, and reset.
Settings files larger than 64 KiB fail closed, and repository-controlled
project settings symlinks are not followed. Setup also refuses to load or
rewrite a project `.gitignore` larger than 1 MiB.
By default the picker reads the active theme ID through OpenCode's local
client and follows the local system light/dark preference. Global
`appearance.theme_id` and `appearance.color_scheme` settings, or the
`OPENCODE_MODEL_DISPATCH_THEME_ID` and
`OPENCODE_MODEL_DISPATCH_COLOR_SCHEME` environment variables, can explicitly
override that behavior.

## Setup

1. Add the package to OpenCode's plugin list.
2. Restart OpenCode and complete the first-run picker.
3. Enable model dispatch.
4. Start one or more built-in `task` calls.
5. Choose a model per row, or use **Apply to all**. Leave **Effort** on
   **Auto** for the simplest provider-default behavior, or choose one of the
   exact effort variants advertised by that model.

Cancel during first-run disables dispatch and snoozes setup for 24 hours.
Cancel from the configuration tool leaves existing settings unchanged.

## Behavior

- Calls are batched per parent session during the configured debounce window.
- Models come from OpenCode's configured provider catalog; disabled,
  deprecated, and OpenCode `-nano` entries hidden by OpenCode are excluded.
- Agent defaults take precedence over the current parent model for preselection.
- Effort defaults to **Auto**. Auto preserves a compatible existing effort
  when the model stays the same; changing models lets the new provider choose
  its default. Explicit effort choices are limited to variants advertised by
  the selected model and are persisted with the child model.
- The original agent identity and task arguments stay unchanged.
- The selected model is applied to the child session's `chat.message` hook,
  persisted as the child session's current model for subsequent turns, and
  reported in task metadata.
- Parallel calls to the same parent agent are serialized until their child
  message is correlated, preventing model selections from swapping.
- Technical picker failures show a warning and use OpenCode's configured
  fallback model. Explicit picker cancellation starts no calls in that batch.

## Privacy

Task prompts, task descriptions, file contents, and model responses are not
sent to the picker or written to plugin logs. Picker rows contain only call
identity, agent name, model catalog data, and model preselection. Operational
logging can include event names, call IDs, model IDs, counts, platform, and
failure categories, and can be disabled globally.

The dispatch layer is local-only: it has no hosted backend, analytics,
telemetry endpoint, updater, or direct model-provider connection. Picker
traffic uses local process stdio and Tauri IPC, settings stay in local files,
and the plugin talks only through the OpenCode client supplied by the host. Its
additional child-session persistence client is created only for a loopback
OpenCode server URL, rejects redirects, and validates the endpoint again for
every request.
OpenCode itself still sends a task to the configured model provider; choose a
local OpenCode provider when the model inference must also remain on-device.

## Troubleshooting

- Run `configure_model_dispatch` if dispatch is inactive.
- Verify that your OS/CPU appears in the support table.
- On Linux, install the distribution packages providing WebKitGTK 4.1 and GTK
  if the native picker does not start.
- Set `OPENCODE_MODEL_DISPATCH_PICKER` to the absolute path of an
  operator-trusted local native binary.
- Run `bun run doctor:picker` in a development checkout to diagnose the Rust,
  Tauri, Node/Bun, and WebKit build prerequisites.
- A technical picker failure deliberately falls back instead of blocking the
  task forever.
- Picker startup uses the configured timeout. Once its UI has started, an
  abandoned picker is terminated after 10 minutes.

## Development

```sh
bun install --frozen-lockfile
bun install --cwd picker --frozen-lockfile
bun test
bun run check:coverage
bun run typecheck
bun run build
bun run --cwd picker build
bun run check:packaging
bun run check:notices
bun run test:package
bun run test:opencode
bun run check:release-source
```

`bun run test:package` packs the currently staged npm payload, installs it without
lifecycle scripts, verifies both Bun and Node ESM imports, and exercises the
installed plugin contract. The publish job performs this check again after all
five native picker assets are staged, then retains and tests that exact
tarball for publication.

The tagged publish workflow runs `bun run check:release-ci` with its automatic
`github.token`, scoped to `actions: read` and `contents: read`, before release
validation. That fail-closed check queries only `ci.yml` push runs for the exact
tagged SHA and requires the newest matching run to have completed successfully.
It never receives a repository-administration or settings token.

`THIRD_PARTY_NOTICES.md` is shipped in the npm tarball. It contains reviewed
notices for the bundled OpenCode SDK/theme sources, Svelte, and Tauri
JavaScript API, plus the complete locked Rust crate graph for every release
target. After dependency changes, run
`cargo install --locked cargo-about --version 0.9.1 --features cli`, then
`bun run notices:generate`, and commit both generated notice files.
`bun run check:notices` regenerates them offline and fails on drift.

`bun run test:opencode` starts a real OpenCode 1.18.7 server, an isolated local
OpenAI-compatible test provider, and a deterministic picker. It drives a
built-in `task` call through the plugin, verifies the chosen model and effort
reach the child request, and checks the resulting session metadata and durable
model-switch event. It then emits two concurrent built-in `task` calls for the
same agent, assigns them different models in picker FIFO order, and follows
both real child sessions and provider requests to prove the selections did not
swap. No external model provider is contacted. Set `OPENCODE_BIN` when OpenCode
is not on `PATH`.

On Linux, `bun run test:package:native:opencode` closes the distribution loop:
it packs and installs the package in an isolated consumer, serves the exact
tarball and its locked dependency graph from an ephemeral loopback-only npm
registry, and makes real OpenCode resolve the documented
`plugin: ["opencode-model-dispatch"]` configuration. It then launches the
installed bundled Tauri picker without a path override, chooses a different
model and explicit effort in the real window, and verifies the resulting child
request and session metadata. CI runs it under X11/Xvfb; the test provider,
registry, and all dispatch control traffic remain local.

For native work:

```sh
bun run doctor:picker
bun run dev:picker:tauri
bun run build:picker
bun run test:picker-ready
bun run test:gui:auto
bun run test:gui
```

`test:picker-ready` is the non-interactive native handshake gate used on every
runnable release target. It waits for the webview to acknowledge that it hydrated
the real start request, rather than accepting process startup alone. On Linux,
`test:gui:auto` drives the real Tauri window's
explicit-effort and submit controls under X11/Xvfb and verifies the production
payload; the installed-package integration additionally changes the selected
model. Native Linux ARM64 runs the same GUI and OpenCode/TUI matrix as x64.
macOS and both Windows architectures run the exact installed-tarball native
handshake. `test:gui` remains the visible cross-platform check: it opens the real
picker with two fixture rows so a release operator can inspect model and effort
selection before clicking **Start tasks**.

## Release

The tag must be exactly `v<package version>`. The publish workflow:

1. validates a clean tracked source tree, tag/main ancestry, changelog,
   synchronized versions, tests, coverage, packaging, a real OpenCode child
   dispatch, and recorded TUI/Desktop evidence;
2. builds, Rust-tests, and ready-smokes unsigned Linux x64/ARM64, macOS ARM64,
   and Windows x64/ARM64 pickers, including real Linux GUI and OpenCode/TUI
   submits, without exposing signing credentials to checked-out source or
   package-manager code;
3. downloads the exact macOS and Windows unsigned artifacts into fresh jobs
   that do not check out the repository, Developer ID signs and notarizes
   macOS, Authenticode signs both Windows architectures, cleans up credentials,
   then uploads only the canonical signed artifacts. It validates all native
   binary formats, packs one exact npm tarball, and drives that same tarball through real
   OpenCode and its installed Linux picker, plus Bun-installed native
   handshake smokes on Linux ARM64, macOS, and both Windows architectures,
   before a registry-only validation
   job routes it to either the protected first-publish bootstrap or a minimal
   token-free trusted-publishing job;
4. publishes the prevalidated draft GitHub release only after npm succeeds,
   with `LICENSE`, `THIRD_PARTY_NOTICES.md`, and SHA-256 checksums alongside
   the native binaries. npm readback must match the tested tarball's SHA-512
   integrity, and `npm audit signatures` must cryptographically verify a SLSA
   provenance attestation bound to the release commit, tag, repository, and
   `publish.yml`.

If a run is retried after the draft release has been staged, the draft's
verified, commit-bound SLSA-attested picker assets remain canonical. The
workflow reuses them for the npm tarball and final release instead of replacing
timestamp-signed macOS or Windows binaries with different rebuilds. Edited or
substituted draft assets fail attestation verification. Do not delete or edit a
staged draft while recovering a release.

The package name is new, so bootstrap its first publish with a short-lived npm
granular access token. Give **Packages and scopes** `Read and write` access to
**All packages** (the new package cannot be selected yet), enable **Bypass
two-factor authentication**, choose the shortest practical expiration, and,
after completing the repository protection setup below, create a protected
GitHub environment named `npm-bootstrap` and store the token there as
`NPM_BOOTSTRAP_TOKEN`. Require a maintainer approval for that environment.
The workflow exposes that secret only to the isolated bootstrap job, and that
job runs only when the package name itself returns npm `E404`; a missing
version of an established package always uses token-free trusted publishing.
The bootstrap job also receives GitHub OIDC solely to create npm provenance
for the first publish; it does not check out or execute repository code.

Immediately after the first version exists, configure its npm trusted
publisher for GitHub repository `Lauritz-Timm/opencode-model-dispatch`,
workflow filename `publish.yml`, no environment, and allowed action
`npm publish`. Revoke the bootstrap token, delete `NPM_BOOTSTRAP_TOKEN`, and
configure the package to require two-factor authentication and disallow token
publishing. Subsequent publishes use only the workflow's OIDC identity; no npm
repository secret is needed.

Before adding any publishing or signing secrets, enable GitHub immutable
releases, private vulnerability reporting, Dependabot security updates, and
strict required CI plus deletion/force-push protection on `main`. Main may use
an active branch ruleset or classic branch protection. Add an active tag
ruleset whose include pattern is exactly `refs/tags/v*`, with no matching
exclusions, and restrict creation, update, and deletion. Because the creation
rule permits only bypass actors to create matching tags, add only the
repository owner user as an always-allowed bypass actor; do not grant a broad
repository role bypass. Configure and review these protections before storing
any release secret, including `NPM_BOOTSTRAP_TOKEN` and the Apple and Windows
signing secrets. A tag-triggered workflow starts immediately, so repository
protection is a mandatory local pre-tag gate rather than a check that receives
an administration token after tagged source has started running.

Complete `docs/manual-integration-gate.md` from the intended source commit and
record its full `git rev-parse HEAD`. Then commit only the completed gate
document on a dedicated branch based on that commit, open a pull request, and
merge it through protected `main`; do not push it directly to `main`. Confirm
the merged commit differs from the tested source only by the gate document and
wait until the CI workflow's push run for that exact merged SHA is completed
successfully. Only then create `v<package version>` at that merged commit and
push the tag. If `main` moved in the meantime, rerun the gate from the new
intended source. The publish workflow requires the tagged commit to equal the
current `origin/main`, rejects a tag containing any other change after the
tested source, and fails if exact-SHA CI is still queued or incomplete.

Run `bun run release:preflight` without privileged tokens, then run
`bun run check:public-repo` as a separate fail-closed gate for the intended
release SHA before tagging.
The source preflight intentionally fails on any modified or untracked source
file, but it does not require cross-platform binaries that cannot be produced
from one clean developer checkout. The tagged workflow builds and signs those
artifacts on their native runners, then `check:release-package` validates their
formats and modes and an npm dry run proves that all five are present. Use
`bun run release:artifact-preflight` only when all five generated
`bin/picker-*` assets have deliberately been staged for inspection.
The public check fails closed unless the repository and exact release SHA meet
the settings above; missing description/topics and an unused enabled wiki are
reported as polish warnings. Live settings verification uses the
`GITHUB_REPOSITORY_SETTINGS_TOKEN` environment variable only in the standalone
local gate process. GitHub deliberately omits a ruleset's bypass actors unless
the caller has write access to that ruleset, so this audit cannot use an
Administration read-only token. Create a short-lived fine-grained personal
access token scoped only to this repository with repository Administration set
to **Read and write**, but do so only after the owner-only release-tag ruleset
has been configured and reviewed. Use a separate read-only `GITHUB_TOKEN` for
the exact-SHA Actions lookup. Pass both tokens only to the separate
`bun run check:public-repo` process, not to `release:preflight` or the parent
shell environment, and revoke the administration token before pushing the
release tag. Never add it as an Actions secret or reuse it as a publishing or
signing credential. The publish workflow intentionally contains no
repository-administration token.

Required release secrets are:

- `NPM_BOOTSTRAP_TOKEN` for the first publish only, configured with the bootstrap
  permissions above;
- `APPLE_CERTIFICATE` (base64 P12), `APPLE_CERTIFICATE_PASSWORD`,
  `APPLE_SIGNING_IDENTITY`, `APPLE_KEYCHAIN_PASSWORD`,
  `APPLE_API_PRIVATE_KEY` (base64 P8), `APPLE_API_KEY_ID`, and
  `APPLE_API_ISSUER_ID`;
- `WINDOWS_CERTIFICATE` (base64 PFX) and
  `WINDOWS_CERTIFICATE_PASSWORD`.

## Contributing

See `CONTRIBUTING.md`.

## Security

See `SECURITY.md`.

## License

MIT. See `THIRD_PARTY_NOTICES.md` for the bundled OpenCode SDK/theme sources,
Svelte and Tauri JavaScript runtime, and native picker's complete Rust
dependency notices.
