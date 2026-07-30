# Contributing

Thanks for helping improve `opencode-model-dispatch`.

Before changing code, read the current design in `docs/architecture.md` and the
repository rules in `AGENTS.md`. The full local workflow and test matrix are in
`docs/development.md`.

## Set Up

The repository uses Bun `1.3.14`.

```sh
bun install --frozen-lockfile
bun install --cwd picker --frozen-lockfile
bun test
bun run typecheck
```

Rust and the platform Tauri prerequisites are needed only for native picker
work. Run `bun run doctor:picker` to check them.

## What Makes a Good Change

- Keep the change small enough to explain and review as one unit.
- Preserve the privacy, fallback, and OpenCode ownership boundaries in
  `docs/architecture.md`.
- Add a focused regression test for behavior changes.
- Update user documentation and the living architecture in the same pull
  request when their contracts change.
- Use GitHub issues for work tracking. Do not add issue briefs, implementation
  plans, or ADRs to the repository.

For a large feature or a change to OpenCode hook timing, picker IPC, native
packaging, privacy, or fallback behavior, discuss the design before investing
in the implementation.

## Verify

Every code change should pass:

```sh
bun test
bun run check:coverage
bun run typecheck
bun run build
```

Also run the relevant area checks:

```sh
# Picker UI or native protocol
bun run --cwd picker build
bun run test:picker:rendered
bun run build:picker
bun run test:picker-ready
bun run test:gui:auto

# Package or OpenCode integration
bun run check:packaging
bun run check:notices
bun run test:package
bun run test:opencode
```

The manual visible GUI check, installed native package checks, and release gate
are required when the corresponding production path changes. See
`docs/development.md` for what each command proves.

## Pull Requests

In the pull request:

- explain the problem and why this change solves it;
- list the commands or manual checks you ran;
- call out user-visible behavior, compatibility, privacy, or packaging impact;
- include before/after screenshots for picker UI changes;
- keep generated files and dependency notices synchronized.

Short, concrete descriptions are easier to review than a transcript of the
implementation process.
