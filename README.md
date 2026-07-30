# opencode-model-dispatch

OpenCode plugin that pauses built-in `task` dispatches, batches calls started
close together, and opens a native model picker before subagents run.

This is an independent community project. It is not affiliated with, sponsored
by, or endorsed by OpenCode or Anomaly.

## Status

Version `0.1.0` is the initial supported release line. Package installation,
the real OpenCode dispatch path, native picker IPC, and release artifacts are
automated gates. TUI and Desktop behavior is verified manually for the exact
release candidate.

## Install

The package supports OpenCode `>=1.18.7 <2`. Add it to your OpenCode
configuration:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-model-dispatch"]
}
```

See the
[OpenCode compatibility matrix](docs/compatibility.md#compatibility-matrix)
for the version guarantee and the
[rolling nightly verification](docs/compatibility.md#rolling-verification-window)
across the current supported OpenCode minor and its five predecessors,
including across a reviewed major-version boundary. Newer plugin versions can
be tried on older OpenCode lines, but only the latest version recorded for that
line is guaranteed.

OpenCode installs configured npm plugins with Bun. No Rust or Tauri toolchain is required,
and no separate `npm install` is needed. The package contains the plugin and
its supported native picker binaries and uses no install lifecycle scripts.

| Operating system | CPU | Status |
| --- | --- | --- |
| Linux glibc, Ubuntu 22.04 baseline | x64 | Supported |
| Linux glibc, Ubuntu 22.04 baseline | ARM64 | Supported |
| macOS | Apple Silicon | Supported |
| Windows 10/11 | x64 | Supported |
| Windows 11 | ARM64 | Supported |

Linux requires the WebKitGTK 4.1 and GTK runtime libraries used by Tauri.
Alpine/musl is not supported. Windows uses WebView2 and macOS uses system
WebKit.

Set `OPENCODE_MODEL_DISPATCH_PICKER` to an absolute compatible picker path to
use an operator-provided build. Other unsupported targets fail with a clear
error.

The expected picker release asset name is
`picker-${platform}-${arch}${ext}`. The same binary is attached to:

`https://github.com/Lauritz-Timm/opencode-model-dispatch/releases/download/v${version}/picker-${platform}-${arch}${ext}`

The package is ESM-only and supports Node.js 18 or newer. The installed
`opencode-model-dispatch-picker` executable is a low-level NDJSON-RPC bridge
for package diagnostics; normal use is through OpenCode.

## Configuration

Dispatch is opt-in. First-run setup and the `configure_model_dispatch` tool
manage:

- global settings in `~/.config/opencode/model-dispatch.json`;
- optional project dispatch settings in `.opencode/model-dispatch.json`;
- optional exclusion of project settings through `.gitignore`.

The settings UI controls dispatch enablement, batching, picker startup timeout,
privacy-safe logging, global/project scope, appearance overrides, and reset.

Settings files larger than 64 KiB fail closed. Project settings symlinks are
not followed, and setup refuses to load or rewrite a project `.gitignore`
larger than 1 MiB.

By default, the picker follows the active local OpenCode theme and the system
light/dark preference. Global `appearance.theme_id` and
`appearance.color_scheme` settings can override them. The environment variables
`OPENCODE_MODEL_DISPATCH_THEME_ID` and
`OPENCODE_MODEL_DISPATCH_COLOR_SCHEME` take final precedence.

Read more about the
[configuration trust boundary](docs/architecture.md#separate-global-trust-from-project-configuration)
or follow the checklist for
[adding or changing a setting](docs/development.md#add-or-change-a-setting).

## Setup

To get started:

1. Add the package to OpenCode's plugin list.
2. Restart OpenCode and complete first-run setup.
3. Enable model dispatch.
4. Start one or more built-in `task` calls.
5. Choose a model for each row or use **Apply to all**.

Leave **Effort** on **Auto** to use the provider default, or choose one of the
exact effort variants advertised by the selected model.

Cancelling first-run setup leaves dispatch disabled and snoozes setup for 24
hours. Cancelling the configuration tool leaves existing settings unchanged.

## Behavior

- Calls are batched per parent session during the configured debounce window.
- Models come from OpenCode's configured provider catalog. Disabled,
  deprecated, and hidden `-nano` entries are excluded.
- An agent model default takes precedence over the current parent model for
  preselection.
- **Auto** preserves a compatible effort when the model stays the same.
  Changing models lets the new provider choose its default.
- The original agent identity and task arguments stay unchanged.
- The selected model is applied to the child message, persisted for later child
  turns, and reported in task metadata.
- Parallel calls to the same parent agent are serialized until each child
  message is correlated, preventing selections from swapping.
- A technical picker failure warns and uses OpenCode's configured fallback
  model.
- Explicit cancellation starts no calls in the affected batch.

See the complete [runtime flow](docs/architecture.md#runtime-flow) and the
[design choices behind it](docs/architecture.md#design-choices).

## Privacy

Task prompts, task descriptions, file contents, and model responses are never
sent to the picker or written to plugin logs. Picker rows contain only call
identity, agent name, model catalog data, and preselection.

Operational logs may include event names, call IDs, model IDs, counts,
platform, and failure categories. Logging can be disabled globally.

The dispatch layer is local-only. It has no hosted backend, analytics,
telemetry endpoint, updater, or direct model-provider connection. Picker
traffic uses process stdio and Tauri IPC; settings remain local files; and the
plugin uses the OpenCode client supplied by the host.

The extra client used to persist the child model permits loopback OpenCode
server URLs only, rejects redirects, and revalidates every endpoint. OpenCode
still sends tasks to the configured model provider; choose a local OpenCode provider
when inference must remain on-device.

Read the full [privacy boundary](docs/architecture.md#keep-the-control-plane-private)
and [security policy](SECURITY.md#privacy-expectations).

## Troubleshooting

- Run `configure_model_dispatch` if dispatch is inactive.
- Confirm that your OS and CPU are supported.
- On Linux, install your distribution's WebKitGTK 4.1 and GTK runtime packages
  if the picker does not start.
- Run `bun run doctor:picker` from a development checkout to diagnose native
  build prerequisites.
- Set `OPENCODE_MODEL_DISPATCH_PICKER` to an absolute, trusted native binary
  when testing a custom picker build.
- A technical failure deliberately falls back instead of blocking a task.
- Picker startup uses the configured timeout. Once started, an abandoned picker
  is terminated after 10 minutes.

## Development

```sh
bun install --frozen-lockfile
bun install --cwd picker --frozen-lockfile
bun test
bun run check:coverage
bun run typecheck
bun run build
```

See the [development guide](docs/development.md) for the repository map,
coding workflow, [common change checklists](docs/development.md#common-changes),
native picker setup, and full test matrix. The current system design and its
constraints are documented in [architecture](docs/architecture.md), and the
[compatibility policy](docs/compatibility.md) explains the moving OpenCode
version gate.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Releasing

Maintainers should follow [the release guide](docs/releasing.md) and the exact
release-candidate evidence checklist in
[the manual integration gate](docs/manual-integration-gate.md).

## Security

See [SECURITY.md](SECURITY.md).

## License

MIT. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the bundled
OpenCode SDK and theme sources, Svelte and Tauri JavaScript runtime, and the
native picker's complete Rust dependency notices.
