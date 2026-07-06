# ADR 0005: Persistent Stdio JSON-RPC for Picker IPC

## Context

The picker needs live model validation. When a user selects a model, the picker
should immediately validate it against the latest OpenCode model list and mark
invalid rows before submit. A one-shot stdin/stdout protocol cannot support this
interaction cleanly.

The plugin starts the picker process, so stdio is available without opening a
localhost port or adding cross-platform named pipe complexity.

## Decision

Use persistent NDJSON JSON-RPC over the picker process stdin/stdout.

Messages are one JSON object per line. Requests and responses use ids. V1
methods include `ready`, `validateModel`, `refreshModels`, `submit`, `cancel`,
and `log`. `resize`, `themeChanged`, and `focusChanged` are reserved but not
active behavior in v1.

## Consequences

The picker can validate selections during the interaction without a local server.

The plugin must handle parse errors, process crashes, startup timeout, lost
stdio, invalid submit payloads, and observed cancellation distinctly.

The IPC layer is more complex than one-shot process execution but remains
portable across supported platforms.
