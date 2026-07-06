# 0015 Tauri Picker App: Setup/Config Mode

Parent: `docs/plan.md`

What to build: Extend the Tauri picker app with setup/configuration mode so first-run setup and the `configure_model_dispatch` tool can edit v1 settings, choose config scope, manage privacy, snooze/cancel, and reset defaults.

Acceptance criteria:
- Implements setup/config mode in the same Tauri shell as picker mode.
- Shows controls for enable dispatch, batch window, startup/connect timeout, technical failure behavior, logging/privacy, and config scope.
- Explains global-only privacy/logging behavior.
- Supports setup cancel and snooze flow.
- Supports reset to defaults.
- Supports project config gitignore choice and warning text.
- Uses the shared JSON-RPC protocol for setup/config messages.
- Tests cover setup/config UI state, validation, reset, cancel/snooze, scope selection, and protocol exchange.

Blocked by: 0013, 0014
