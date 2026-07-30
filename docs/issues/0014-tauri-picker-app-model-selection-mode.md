# 0014 Tauri Picker App: Model Selection Mode

Parent: [`PRODUCT.md`](../../PRODUCT.md)

Status: implemented with catalog-at-launch IPC and the current keyboard
interaction.

What to build: Build the Tauri picker app's model selection mode, including OpenCode-like theming, adaptive always-on-top window behavior, task rows, apply-to-all, dropdown search, validation state, submit/cancel, and keyboard interaction.

Acceptance criteria:
- Adds `picker/` Tauri app for model selection mode.
- Uses OpenCode-like dark/light theme tokens and best-effort theme resolver.
- Implements adaptive always-on-top focused window behavior.
- Shows apply-to-all first, then one row per task.
- Task rows show the agent type; prompts and task descriptions are not sent to
  the picker.
- Dropdown groups models by provider and supports search.
- Apply-to-all applies the selected model to all rows and keeps focus on apply-to-all.
- Each selected model has an effort control whose default is `Auto`; it lists
  only that model's advertised variants and clears incompatible effort on a
  model change.
- Submit is disabled until every row has a model.
- Dropdown keyboard behavior supports arrows, Home, End, Enter, and Escape;
  global Enter submits a valid model view and Escape cancels.
- Unit tests cover rows, preselection, apply-to-all, dropdown search, submit
  state, and keyboard commands.
- Contract test exchanges NDJSON JSON-RPC with the plugin test harness.

Blocked by: 0005
