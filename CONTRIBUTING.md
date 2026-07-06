# Contributing

Thanks for your interest in `opencode-model-dispatch`.

## Project State

This project is pre-alpha. The public contract is the architecture decision
record, not a working plugin. Start with:

- `docs/adr/`

## Development Rules

- Complete hard spikes before feature implementation.
- Use test-first development for production behavior.
- Keep logs free of prompts, descriptions, user text, and sensitive data.
- Do not add private OpenCode config reads except the documented theme exception.

## Commands

```sh
bun install
bun test
bun run typecheck
bun run build
```

## Pull Requests

Before opening a PR:

- Ensure docs are updated for behavior changes.
- Run the relevant tests.
- Note any hard-gate result or manual OpenCode integration result.
- Keep PRs focused on one change or decision.
