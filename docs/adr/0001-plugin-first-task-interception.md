# ADR 0001: Plugin-First Task Interception

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

The plugin will leave `task` unchanged when dispatch is disabled. When enabled,
it will pause intercepted task calls, collect model selections, mutate the task
arguments as needed, and then let the built-in `task` implementation continue.

## Consequences

Agents keep using the normal subagent flow.

The plugin does not need to reimplement task output, child session creation,
permissions, foreground/background behavior, or metadata if the interception path
works.

The design depends on `tool.execute.before` being able to wait for user input and
mutate `output.args.subagent_type` before built-in `task` resolves the subagent.
