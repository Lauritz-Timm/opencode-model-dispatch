# 0008 Shadow-Agent Creation

Parent: `docs/plan.md`

What to build: Implement the pure shadow-agent creation helpers that generate internal lookup keys and config injection shapes for selected per-task models while preserving original agent identity.

Acceptance criteria:
- Creates a shadow definition from the current agent and selected model.
- Uses an internal lookup key while preserving original `name`.
- Copies permissions, prompt, mode, tools/options, description, and relevant metadata from the latest source agent.
- Generated keys are unique per call and safe for config keys.
- Exposes config injection shape needed by plugin hook wiring.
- Tests cover key generation, copied fields, selected model override, and display-name preservation.

Blocked by: 0001
