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

## Install

The package is not published yet. Once published, install it in the same
environment where OpenCode loads plugins:

```sh
npm install opencode-model-dispatch
```

No Rust or Tauri toolchain is required for published package installs. The npm
package ships the plugin JavaScript and uses a platform picker release asset
instead of building native code during `npm install`.

The expected picker release asset name is `picker-${platform}-${arch}${ext}`.
The documented download path is
`https://github.com/Lauritz/opencode-model-dispatch/releases/download/${version}/picker-${platform}-${arch}${ext}`.
Use `ext=.exe` on Windows and an empty extension on Linux and macOS.

Release assets are produced by `bun run build:picker`, which runs a CI-friendly
Tauri build and copies the native binary into `dist-picker` with the expected
platform asset name.

## Configuration

The eventual OpenCode config shape is expected to be:

```jsonc
{
  "plugin": ["opencode-model-dispatch"]
}
```

Dispatch remains opt-in after installation. First-run setup configures settings
such as `dispatch.enabled`, batch timing, timeout behavior, and privacy logging
preferences.

Set `OPENCODE_MODEL_DISPATCH_PICKER` to an absolute picker binary path when you
want to override the downloaded release asset, test a local native build, or run
from a custom installation directory.

## Setup

1. Install the plugin package.
2. Add `opencode-model-dispatch` to the OpenCode plugin list.
3. Run the first dispatch setup flow when prompted.
4. Enable dispatch after confirming picker launch and privacy settings.

The picker is expected to launch from the platform release asset path above, or
from `OPENCODE_MODEL_DISPATCH_PICKER` when that environment variable is set.

## Privacy

The plugin is designed to avoid logging task prompts, model responses, file
contents, or other prompt-derived payloads. Privacy-safe logs may include event
names, batch sizes, selected model IDs, timeout reasons, and technical picker
failure categories.

## Troubleshooting

- If picker launch fails, verify that the release asset name matches
  `picker-${platform}-${arch}${ext}` for your operating system and CPU.
- If using a local picker build, set `OPENCODE_MODEL_DISPATCH_PICKER` to the
  absolute binary path.
- If install attempts to build Rust or Tauri code, check that you are installing
  the published package and not a development checkout.
- If dispatch is inactive, confirm `dispatch.enabled` was enabled during setup.

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
bun run doctor:picker
bun run dev:picker:tauri
bun run build:picker
bun run check:packaging
```

Use `bun run doctor:picker` before native picker work to verify Rust, Tauri, and
picker dependencies are available. Use `bun run dev:picker:tauri` to launch the
native picker during development, and `bun run build:picker` to produce the
platform release asset in `dist-picker`.

Use test-first implementation. Do not skip the hard technical spikes.

## Contributing

See `CONTRIBUTING.md`.

## Security

See `SECURITY.md`.

## License

MIT
