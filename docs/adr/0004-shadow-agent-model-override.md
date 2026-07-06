# ADR 0004: Shadow Agents for Model Override

## Context

Built-in `task` does not expose a public `model` argument. It chooses the child
model from the resolved subagent's configured model and otherwise falls back to
the parent/current message model.

OpenCode agent config can set an agent `model`, and agent config can override
the returned agent `name`. This suggests a plugin-only path: route the task to a
temporary agent definition that has the selected model while preserving the
original agent name.

## Decision

Use ephemeral per-call shadow agents as the model override mechanism.

For each selected task, the plugin creates or exposes a shadow agent with an
internal lookup key, copies the latest original agent definition, sets the
selected model, preserves the original agent `name`, and rewrites
`subagent_type` to the shadow lookup key before built-in `task` runs.

## Consequences

The built-in `task` tool can remain authoritative for execution.

The implementation must prove that a shadow agent can be registered before
`agent.get()` runs and that child session history/UI shows the original agent
name, not the shadow key.

If either invariant fails, the plugin cannot safely use this path and must wait
for upstream OpenCode support for a public per-call task model override.
