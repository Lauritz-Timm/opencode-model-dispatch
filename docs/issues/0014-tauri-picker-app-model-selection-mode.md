# 0014 Tauri Picker App: Model Selection Mode

Parent: `docs/plan.md`

What to build: Build the Tauri picker app's model selection mode, including OpenCode-like theming, adaptive always-on-top window behavior, task rows, apply-to-all, dropdown search, validation state, submit/cancel, and keyboard interaction.

Acceptance criteria:
- Adds `picker/` Tauri app for model selection mode.
- Uses OpenCode-like dark/light theme tokens and best-effort theme resolver.
- Implements adaptive always-on-top focused window behavior.
- Shows apply-to-all first, then one row per task.
- Task rows show agent type and truncated/expandable description; prompts are not shown.
- Dropdown groups models by provider and supports search.
- Apply-to-all applies the selected model to all rows and keeps focus on apply-to-all.
- Live validation errors mark invalid rows and disable submit.
- Keyboard behavior matches the spec for Enter, Esc, Shift+Enter, Shift+Esc, and arrow keys.
- Unit tests cover UI state reducer for rows, apply-to-all, dropdown, search, validation errors, submit disabled state, and keyboard commands.
- Contract test exchanges NDJSON JSON-RPC with the plugin test harness.

Blocked by: 0004, 0005
