# ADR 0002: Bundled Tauri Overlay Picker

## Context

The picker should feel visually aligned with OpenCode and appear above the
current OpenCode surface. It should not use OpenCode's `question` tool, and it
does not need to be rendered inside OpenCode's native TUI/Desktop UI.

The plugin can start external processes. A browser popup would be easier but
would feel less integrated. Native OpenCode UI would require OpenCode core
changes.

## Decision

Bundle a Tauri mini-window picker with the plugin.

The picker will be a focused always-on-top external overlay, packaged as
prebuilt binaries per platform. It will use OpenCode-like dark/light styling,
best-effort theme loading, plugin branding, keyboard navigation, apply-to-all,
and per-task model selection.

## Consequences

The plugin can ship the desired custom UI without OpenCode core UI changes.

Release packaging becomes more complex because platform binaries must be built
and distributed.

The picker is not truly native OpenCode UI, so exact theme and window integration
are best-effort rather than guaranteed.
