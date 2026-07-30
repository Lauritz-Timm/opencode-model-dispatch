# Contributing

Thanks for your interest in `opencode-model-dispatch`.

## Project State

This project is preparing its initial `0.1.x` release line. Architecture
decisions and the product constraints remain part of the public contract.
Start with:

- `docs/adr/`
- `PRODUCT.md`
- `docs/manual-integration-gate.md`

## Development Rules

- Complete hard spikes before feature implementation.
- Use test-first development for production behavior.
- Keep picker payloads and logs free of prompts, descriptions, user text, and
  sensitive data.
- Do not add private OpenCode config reads except the documented theme exception.

## Commands

```sh
bun install
bun test
bun run typecheck
bun run build
bun run test:package
bun run test:opencode
```

## Pull Requests

Before opening a PR:

- Ensure docs are updated for behavior changes.
- Run the relevant tests.
- Note any hard-gate result or manual OpenCode integration result.
- Run the native ready/GUI gates when changing the picker or process protocol.
- Keep PRs focused on one change or decision.
