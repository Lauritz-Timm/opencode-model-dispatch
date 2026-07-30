# Repository Guidelines

This file is the short, operational guide for writing code in this repository.
Human contributors should start with `CONTRIBUTING.md`; architectural context
lives in `docs/architecture.md`.

## Repository Map

- `src/` contains the OpenCode plugin and its runtime boundaries.
- `picker/src/` contains the Svelte picker UI, pure state reducers, protocol
  validation, and bundled OpenCode theme support.
- `picker/src-tauri/` contains the small native Tauri host.
- `test/` contains plugin, protocol, packaging, and integration tests.
- `scripts/` contains build, packaging, smoke-test, and release tooling.
- `docs/` contains living architecture, development, and release guidance.

## General Style

- Use Bun for installs, scripts, and tests. Keep Node.js 18 compatibility for
  the published ESM package.
- Keep TypeScript strict. Prefer precise types and narrow `unknown` at
  boundaries; do not introduce `any`.
- Prefer `const`, early returns, and a readable happy path. Avoid `else` after a
  branch that already returns.
- Keep logic together until extracting a helper names a real concept, isolates
  a complex boundary, or enables reuse. Do not create single-use abstractions
  for simple expressions.
- Keep helpers near the code they support and below the primary exported
  operation when practical.
- Use comments for constraints, security properties, and surprising behavior,
  not for restating the code.
- Follow the surrounding file's naming and formatting. Repository source uses
  no semicolons and double-quoted strings.
- Include `.js` in relative imports emitted by the published plugin. Tests may
  use extensionless imports as supported by Bun.

## Runtime Boundaries

- Treat OpenCode, settings files, environment variables, picker messages, and
  process output as untrusted input. Validate shape, size, identity, and
  lifecycle before use.
- Bound input before parsing or allocating from it. Preserve the existing
  fail-closed behavior for invalid settings, catalogs, RPC lines, and
  non-loopback persistence endpoints.
- Keep explicit user cancellation separate from technical failure. Cancellation
  starts no task; technical failure warns and lets OpenCode use its configured
  fallback model.
- Do not send task prompts, task descriptions, file contents, model responses,
  or prompt-derived text to the picker or plugin logs.
- Do not add a hosted backend, analytics, telemetry, updater, network listener,
  or direct provider connection.
- Use the OpenCode SDK as the source of truth for providers, models, agents,
  sessions, and messages. Direct OpenCode file reads are limited to the
  documented local theme behavior.

## Plugin Code

- Keep OpenCode's built-in `task` tool responsible for permissions, child
  sessions, execution, cancellation, output, and agent identity.
- Preserve `task` arguments. Apply a selected model only through the correlated
  child `chat.message` hook and session model persistence.
- Preserve FIFO serialization for concurrent calls with the same parent and
  agent unless a newer supported OpenCode API provides exact pre-message call
  correlation.
- Keep batching isolated by parent session. One batch failure must settle every
  waiter and must not strand later batches.
- Dependency injection in public constructors and plugin factories is
  preferred over global mutation so behavior remains testable.

## Picker Code

- Keep selection, effort, setup, and request validation logic in pure TypeScript
  modules where possible. Svelte components should primarily render state and
  translate user actions.
- Keep the UI compact, keyboard-first, and aligned with OpenCode theme tokens.
  Escape cancels; Enter submits only a valid selection.
- Preserve visible focus, hover, selected, disabled, and error states. Do not
  rely on color alone.
- Keep the `ready` → `start` → `started` → `submit`/`cancel` NDJSON-RPC
  lifecycle compatible on both sides whenever the protocol changes.
- Changes to bundled OpenCode theme sources require a source/license review and
  regenerated third-party notices where applicable.

## Tests

- Add or update a focused regression test for every behavior change.
- Test public behavior and real boundaries rather than copying implementation
  logic into the test.
- Prefer injected fakes over global mocks. Use real OpenCode, native picker, and
  installed-package tests when changing the integration contract.
- Keep fixtures free of real prompts, secrets, home paths, and client data.
- Run the smallest relevant check while iterating, then the required area
  checks before handing off a change.

Common checks:

```sh
bun test
bun run check:coverage
bun run typecheck
bun run build
bun run --cwd picker build
```

Picker or protocol changes also require:

```sh
bun run test:picker:rendered
bun run test:picker-ready
bun run test:gui:auto
```

Packaging or OpenCode integration changes also require:

```sh
bun run check:packaging
bun run test:package
bun run test:opencode
```

## Documentation

- Update `README.md` for user-visible behavior or configuration.
- Update `docs/architecture.md` when a durable boundary or design choice
  changes. Keep it current; do not add an ADR.
- Update `docs/development.md` when the development workflow or required checks
  change.
- Update `docs/compatibility.md` when the OpenCode engine range, pinned SDK
  contract, or nightly compatibility process changes.
- Update `docs/releasing.md` and the manual gate only when release operations
  change.
- Use GitHub issues and pull requests for work tracking. Do not add issue
  backlogs or implementation-status documents to the repository.
