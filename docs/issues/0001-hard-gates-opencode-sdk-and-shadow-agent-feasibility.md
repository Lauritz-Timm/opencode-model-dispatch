# 0001 Hard Gates: OpenCode SDK And Shadow-Agent Feasibility

Parent: `docs/plan.md`

What to build: Prove the critical OpenCode integration assumptions before dependent implementation proceeds: enabled/visible model discovery through stable SDK/API, agent model metadata, parent/current model discovery, shadow-agent display-name invariants, per-call shadow registration timing, task hook mutation safety, and child-session mapping viability.

Acceptance criteria:
- `probeVisibleModels(client)` accepts provider/model responses with enabled/visible information.
- The probe rejects responses where model visibility cannot be determined.
- Provider/model order from OpenCode is preserved.
- Shadow-agent creation preserves original agent `name` while using an internal lookup key.
- Shadow-agent definitions copy permissions, prompt, mode, tools/options, description, and selected model from the latest source agent.
- Generated shadow keys are unique per call and safe for config keys.
- A local OpenCode spike confirms per-call shadow agents can be exposed before built-in `task` resolves `agent.get()`.
- If any hard gate fails, implementation stops and the requirement for upstream API support is documented.

Blocked by: -
