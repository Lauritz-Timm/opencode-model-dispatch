# ADR 0001: Plugin-First Task Interception

Status: accepted. The original subagent-type mutation mechanism is superseded
by ADR 0009.

## Context

The desired behavior is automatic model selection whenever an agent dispatches a
subagent. Agents should keep calling OpenCode's built-in `task` tool. A custom
`dispatch_agent` tool would require steering the model to use a different tool,
and the OpenCode `question` tool does not provide the desired custom picker UI.

OpenCode plugins can hook `tool.execute.before` and mutate tool arguments before
execution.

## Decision

Implement model dispatch as a standalone plugin that intercepts built-in `task`
calls through `tool.execute.before`.

The plugin leaves `task` unchanged when dispatch is disabled. When enabled, it
pauses intercepted task calls, collects model selections, and then lets the
built-in `task` implementation continue without changing the requested agent
or task arguments. ADR 0009 records how the selected model is correlated with
and applied to the child message after OpenCode creates the child session.

## Consequences

Agents keep using the normal subagent flow.

The plugin does not need to reimplement task output, child session creation,
permissions, foreground/background behavior, or metadata if the interception path
works.

The design depends on `tool.execute.before` being able to wait for user input
before built-in `task` runs, plus `chat.message` exposing the child session in
time to apply the correlated model override.
