# 0010 Plugin Hook Wiring: Disabled And Single-Task Success

Parent: `docs/plan.md`

What to build: Wire the plugin hooks for the disabled path and the first successful single-task dispatch path by composing settings, model catalog, picker process, shadow-agent creation, and task argument rewriting.

Acceptance criteria:
- Plugin returns hooks: `config`, `event`, `dispose`, `tool.execute.before`, `tool.execute.after`, and custom tool registration placeholder if needed.
- Disabled dispatch leaves task args unchanged.
- Enabled dispatch waits for a single picker result.
- Successful selection creates a shadow agent and rewrites only `output.args.subagent_type` to the shadow key.
- Built-in task execution remains responsible for child session creation, permissions, metadata, and output.
- Tests cover disabled behavior and single-task success with real-shape OpenCode SDK fakes.

Blocked by: 0002, 0004, 0006, 0008
