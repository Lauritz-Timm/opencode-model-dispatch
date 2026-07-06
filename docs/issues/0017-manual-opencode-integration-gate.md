# 0017 Manual OpenCode Integration Gate

Parent: `docs/plan.md`

What to build: Run the final manual integration gate against a local OpenCode instance in a scratch project, validating the complete plugin, picker, setup, dispatch, batching, failure, display-name, and cleanup behavior before release.

Acceptance criteria:
- Local OpenCode starts with the plugin installed in a scratch project.
- First-run setup opens at plugin load.
- Dispatch remains disabled if setup is cancelled and snoozed.
- Enabling dispatch works.
- One built-in `task` opens the picker and selection overrides the model.
- Multiple parallel `task` calls batch into one picker.
- Apply-to-all and per-row selections both work.
- Child sessions show original agent names in TUI/Desktop history.
- Technical picker failure falls back to built-in task default/current model with warning.
- Explicit cancel starts no subagents.
- Archiving child sessions triggers shadow cleanup.
- Any failed hard gate or manual check is documented before release continues.

Blocked by: 0011, 0012, 0016
