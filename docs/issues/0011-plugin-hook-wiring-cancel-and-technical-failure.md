# 0011 Plugin Hook Wiring: Cancel And Technical Failure

Parent: `docs/plan.md`

What to build: Complete plugin hook failure semantics for user cancel and technical picker failure, including privacy-safe logging, warning paths, and preservation of original task args on fallback.

Acceptance criteria:
- Cancel throws `Error("Model selection cancelled")`.
- Cancel starts no subagents for the affected batch.
- Technical failure leaves args unchanged and emits a user-facing warning path.
- Technical failure uses OpenCode's normal configured/default/current model behavior.
- Logs use `MODEL_DISPATCH_CANCELLED` and `MODEL_DISPATCH_PICKER_FAILED` without sensitive user text.
- Tests cover cancel, technical failure, logging enabled, logging disabled, and unchanged args on fallback.

Blocked by: 0003, 0006, 0007, 0010
