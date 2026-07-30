# Development

This guide covers local setup, repository structure, and the checks expected
for code changes. Coding conventions are summarized in `AGENTS.md`; the reasons
behind the main boundaries live in `docs/architecture.md`.

## Requirements

- Bun `1.3.14`
- Node.js `18` or newer for package-consumer verification
- Rust `1.97.1` and platform Tauri prerequisites for native picker work
- OpenCode `1.18.7` for the pinned minimum integration contract; nightly CI
  additionally tests the latest patch in the current supported minor and its
  five predecessors

The JavaScript plugin can be developed without compiling the native picker.
Run the picker doctor before native work:

```sh
bun run doctor:picker
```

## Setup

```sh
bun install --frozen-lockfile
bun install --cwd picker --frozen-lockfile
bun test
bun run typecheck
```

Use the frozen lockfiles in normal development and CI-facing verification. Add
or update dependencies deliberately, then commit the resulting lockfile.

## Repository Structure

| Path | Responsibility |
| --- | --- |
| `src/index.ts` | Plugin hooks, dispatch orchestration, and model override correlation |
| `src/batcher.ts` | Parent-session batching and waiter lifecycle |
| `src/model-catalog.ts` | SDK model catalog shaping and preselection |
| `src/picker-process.ts` | Native process lifecycle, timeouts, and stdio |
| `src/picker-rpc.ts` | Shared plugin-side JSON-RPC validation |
| `src/settings.ts` | Bounded global/project configuration |
| `src/setup.ts` | First-run and configuration decisions |
| `picker/src/` | Svelte UI plus pure reducers and validators |
| `picker/src-tauri/` | Native Tauri host and stdio/webview bridge |
| `test/` | Unit, contract, packaging, and integration tests |
| `scripts/` | Build, smoke-test, package, and release tooling |

## Working on a Change

1. Read the relevant section in `docs/architecture.md` and nearby tests.
2. Reproduce the behavior with the smallest focused test or command.
3. Change one boundary at a time and keep the patch focused.
4. Add a regression test for new or corrected behavior.
5. Run the focused test while iterating.
6. Run the area checks below before opening a pull request.
7. Update user or architecture documentation in the same patch when behavior
   or a durable design rule changes.

Do not create repository-local issue briefs or ADRs. Use GitHub issues for work
tracking and keep only the current design in the repository.

## Writing Plugin Code

- Preserve OpenCode's built-in `task` lifecycle and original arguments.
- Read OpenCode state through the supported SDK contract.
- Validate all file, SDK, process, and protocol data before use.
- Keep user cancellation distinct from technical failure.
- Ensure every asynchronous waiter settles on success, cancellation, failure,
  timeout, and disposal.
- Keep task prompts, descriptions, file content, and responses out of picker
  payloads and logs.
- Keep Node.js compatibility in published code; Bun-only APIs are appropriate
  in tests and repository scripts when they do not enter the package output.

The main plugin factory accepts dependencies for tests. Extend that pattern
instead of mutating globals or making tests depend on timing and local state.

## Writing Picker Code

Put state transitions and input validation in pure TypeScript modules. Keep
Svelte components focused on rendering and translating DOM events into reducer
actions. This makes keyboard, selection, effort, and setup behavior testable
without a native window.

When changing the protocol, update and test both the plugin and picker sides.
Preserve bounded messages and the `ready`, `start`, `started`, then terminal
`submit`/`cancel` lifecycle.

Use OpenCode theme tokens and the existing density. Verify keyboard-only flow,
visible focus, light and dark themes, narrow layouts, native close, and both
valid and invalid submission states.

Start the native development window with:

```sh
bun run dev:picker:tauri
```

Use the browser preview for quick visual work:

```sh
bun run dev:picker
```

## Tests and Checks

### Plugin logic

```sh
bun test
bun run check:coverage
bun run typecheck
bun run build
```

`bun test <path>` is useful while iterating. Run the complete plugin suite
before handing off a runtime change.

### Picker UI or protocol

```sh
bun run --cwd picker build
bun run test:picker:rendered
bun run build:picker
bun run test:picker-ready
bun run test:gui:auto
```

`test:picker:rendered` covers computed themes, layout, and keyboard behavior.
`test:picker-ready` proves that the native webview hydrated the real start
request. `test:gui:auto` drives the production Tauri UI on Linux. Run
`bun run test:gui` as the final visible inspection when native interaction or
layout changes.

### OpenCode integration or packaging

```sh
bun run check:packaging
bun run check:notices
bun run test:package
bun run test:opencode
```

`test:package` packs the staged npm payload, installs it without lifecycle
scripts, and verifies Bun and Node ESM consumers.

`test:opencode` starts a pinned real OpenCode server and a local deterministic
provider. It verifies selected model and effort persistence, task metadata, and
same-agent FIFO correlation without contacting an external model provider. Set
`OPENCODE_BIN` and the matching exact `OPENCODE_TEST_VERSION` to test a
specific executable. See the
[compatibility policy](compatibility.md#rolling-verification-window) for the
automated rolling matrix.

On Linux, `bun run test:package:native:opencode` additionally installs the
tarball through an isolated loopback npm registry and drives its bundled native
picker through a real task.

## Common Changes

Use these checklists to find the complete change surface before editing. They
are starting points, not substitutes for reading the nearby implementation and
tests.

### Add or Change a Setting

1. Define the type, default, bounds, decoding, and merge behavior in
   `src/settings.ts`.
2. Update read/write decisions in `src/setup.ts`.
3. Update the setup state in `picker/src/setup-reducer.ts` and its controls in
   `picker/src/App.svelte`.
4. Preserve the trust boundary: project files may override dispatch behavior,
   while privacy and appearance remain global.
5. Add focused coverage in `test/settings.test.ts`, `test/setup.test.ts`, and
   picker reducer or UI contract tests.
6. Update the README configuration section and `docs/architecture.md` if the
   trust model or defaults change.

Run:

```sh
bun test test/settings.test.ts test/setup.test.ts test/picker-ui.test.ts
bun run typecheck
```

### Change the Picker Protocol

1. Update plugin-side message validation in `src/picker-rpc.ts` and process
   lifecycle handling in `src/picker-process.ts`.
2. Update picker-side shapes and validation in `picker/src/protocol.ts`,
   `picker/src/runtime-rpc.ts`, and `picker/src/runtime-request.ts`.
3. Update the Tauri bridge when framing, lifecycle, or native close behavior
   changes.
4. Keep every message bounded and preserve the
   `ready` → `start` → `started` → `submit`/`cancel` lifecycle unless the
   architecture changes deliberately.
5. Update protocol, runtime, process, rendered UI, and native ready tests on
   both sides of the boundary.

Run:

```sh
bun test test/picker-rpc.test.ts test/picker-process.test.ts test/picker-runtime-smoke.test.ts
bun run test:picker-ready
```

### Update the OpenCode SDK Contract

1. Update the pinned plugin and SDK versions together in `package.json` and
   regenerate `bun.lock`.
2. Review every adapter in `src/index.ts`, `src/model-catalog.ts`, and
   `src/opencode-capabilities.ts` against the supported SDK response shapes and
   hook timing.
3. Keep OpenCode as the source of truth. Do not replace an unavailable SDK
   field with an undocumented config-file read.
4. Update capability, catalog, hook, declaration, installed-package, and real
   OpenCode tests.
5. Change the documented OpenCode engine range only after the complete
   integration path passes for that range.
6. For a release, update every exact OpenCode version that passed the rolling
   workflow to the new plugin version and append newly tested runtime versions.
7. When an OpenCode minor becomes more than five lines older than the current
   minor, keep all of its exact-version rows and mark them archived.

Run:

```sh
bun test test/opencode-capabilities.test.ts test/model-catalog.test.ts test/plugin-hooks.test.ts
bun run test:package
bun run test:opencode
```

### Update Bundled OpenCode Themes

1. Record the new upstream source commit in
   `picker/src/opencode-themes/README.md`.
2. Update the theme snapshot and resolver together; do not mix files from
   different upstream revisions.
3. Review source attribution, licenses, and `third-party/components.json`.
4. Regenerate third-party notices.
5. Verify light, dark, explicit, system, unknown-theme, and computed-token
   behavior.

Run:

```sh
bun run notices:generate
bun run check:notices
bun run test:picker:rendered
```

### Add a Supported Platform

1. Add one canonical platform/architecture mapping in
   `src/picker-targets.ts`.
2. Update native target resolution, build tooling, the package launcher,
   release workflows, and artifact validation.
3. Follow the existing `picker-${platform}-${arch}${ext}` asset contract.
4. Add the platform to the README support table and document its runtime
   requirements.
5. Add architecture, binary-format, ready-handshake, installed-package, and
   release-matrix coverage. Every supported OS/architecture pair must have its
   own named CI check, and a platform is not supported until CI runs its
   production artifact natively.

Run:

```sh
bun test test/picker-targets.test.ts test/packaging.test.ts
bun run check:packaging
bun run test:package
```

### Change Privacy-sensitive Logging

1. Treat every new log field as public operational metadata.
2. Keep prompts, descriptions, user text, file content, model responses, and
   prompt-derived values out of log inputs as well as serialized output.
3. Preserve complete suppression when `privacy.logging_enabled` is false while
   retaining local user-facing warnings.
4. Update `test/logging.test.ts`, `SECURITY.md`, the README privacy section, and
   the architecture privacy boundary when the observable contract changes.

Run:

```sh
bun test test/logging.test.ts test/local-runtime.test.ts
bun run typecheck
```

## Generated and Third-party Files

Do not hand-edit `THIRD_PARTY_NOTICES.md` or
`third-party/RUST_THIRD_PARTY_LICENSES.md`. After dependency or bundled-source
changes, install the pinned generator and regenerate:

```sh
cargo install --locked cargo-about --version 0.9.1 --features cli
bun run notices:generate
bun run check:notices
```

The files under `picker/src/opencode-themes/` are adapted from OpenCode. Keep
their source attribution current and review license/notices whenever the
snapshot changes.

Native picker binaries and build directories are generated artifacts. Do not
commit a local build unless the release workflow explicitly calls for staged
artifact inspection.

## Documentation

- `README.md`: installation, behavior, configuration, and troubleshooting.
- `CONTRIBUTING.md`: contributor entry point and pull request expectations.
- `AGENTS.md`: concise coding rules used by humans and coding agents.
- `docs/architecture.md`: current system design and durable choices.
- `docs/compatibility.md`: OpenCode support matrix and nightly verification.
- `docs/development.md`: local workflow and verification.
- `docs/releasing.md`: maintainer-only release process.
- `docs/manual-integration-gate.md`: evidence template for a release candidate.
