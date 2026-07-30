# ADR 0005: Persistent Stdio JSON-RPC for Picker IPC

## Context

The picker needs a startup handshake, one structured request, and an explicit
submit-or-cancel result. Keeping stdin open also lets the picker terminate when
its owning OpenCode/plugin process disappears.

The plugin starts the picker process, so stdio is available without opening a
localhost port or adding cross-platform named pipe complexity.

## Decision

Use NDJSON JSON-RPC notifications over the picker process stdin/stdout.

Messages are one JSON object per line. V1 uses `ready` from picker to plugin,
`start` from plugin to picker, `started` from picker to plugin after the
webview has accepted and hydrated that request, and one terminal `submit` or
`cancel` from picker to plugin. The startup timeout remains active until
`started`, so a blank or rejected picker request fails into the technical
fallback instead of leaving a stuck window. After `started`, a separate
10-minute decision timeout bounds an abandoned or unresponsive picker. Both
directions cap a single RPC line at 4 MiB, and every technical transport failure
terminates the child process. The complete model catalog is captured
immediately before launch; v1 has no live model-refresh or validation RPC.

## Consequences

The picker can exchange its complete request and decision without a local
server or exposing a network listener.

The plugin must handle parse errors, oversized input, process crashes, startup
and decision timeouts, lost stdio, invalid submit payloads, and observed
cancellation distinctly.

The IPC layer is more complex than one-shot process execution but remains
portable across supported platforms.
