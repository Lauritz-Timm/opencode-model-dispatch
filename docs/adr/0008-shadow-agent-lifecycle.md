# ADR 0008: Shadow Agent Lifecycle and Cleanup

## Context

Shadow agents may be referenced by child sessions after a task completes. If the
plugin deletes a shadow agent immediately, session history may later reference a
missing agent definition. Keeping shadow agents forever would leak internal
state.

OpenCode session updates include archive state through `time.archived`.

## Decision

Keep mapped shadow agents until their child session is archived.

The plugin stores shadow state in a global plugin cache. It tracks
`callID -> shadowKey` before task execution and `shadowKey -> childSessionID`
after task metadata exposes the child session. Dispose removes only orphaned
shadows with no child session id. Session archive and startup GC remove mapped
shadows whose child sessions are archived or missing.

## Consequences

Active session history can continue resolving shadow-backed agents.

The plugin needs reliable mapping from task call to child session id.

Startup and dispose cleanup are required to handle crashes, failed tasks, and
orphaned shadow entries.
