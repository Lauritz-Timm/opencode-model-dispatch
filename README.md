# opencode-model-dispatch

Pre-alpha OpenCode plugin project for automatic model selection when agents
dispatch subagents.

The intended plugin intercepts built-in `task` calls, batches near-simultaneous
subagent dispatches, and opens a bundled Tauri overlay picker so the user can
choose one model for all tasks or a model per task.

## Status

This repository is design-first and not ready for production use.

Implementation is gated by technical spikes. In particular, the project must
prove that OpenCode exposes the same enabled/visible model list as its model
picker and that per-call shadow agents can preserve original subagent names in
history.

## Design Docs

- Architecture decisions: `docs/adr/`

## Expected Install

The package is not published yet. The eventual OpenCode config shape is expected
to be:

```jsonc
{
  "plugin": ["opencode-model-dispatch"]
}
```

Dispatch will remain opt-in after installation. First-run setup will configure
settings such as `dispatch.enabled`, batch timing, timeout behavior, and privacy
logging preferences.

## Expected Behavior

- Intercept built-in `task` tool calls.
- Batch task calls that arrive within 500 ms.
- Open a focused always-on-top Tauri picker.
- Use OpenCode SDK data for visible models and agent defaults.
- Override selected task models through ephemeral shadow agents.
- Let the built-in `task` implementation handle execution and output.
- Fall back to OpenCode's default/current model on technical picker failure.
- Cancel the whole batch when the user explicitly cancels the picker.

## Development

```sh
bun install
bun test
bun run typecheck
bun run build
```

Use test-first implementation. Do not skip the hard technical spikes.

## Contributing

See `CONTRIBUTING.md`.

## Security

See `SECURITY.md`.

## License

MIT
