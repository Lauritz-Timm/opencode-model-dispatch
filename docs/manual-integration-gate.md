# Manual OpenCode Integration Gate

Status: not run in this checkout.

This gate must be executed against a local OpenCode instance in a scratch project before any release continues. Automated tests cover the plugin composition, picker protocol, setup backend, batching, logging, shadow-cache, packaging checks, and picker reducers; they do not prove the live OpenCode integration hard gates.

## Checklist

- [ ] Local OpenCode starts with the plugin installed in a scratch project.
- [ ] First-run setup opens at plugin load.
- [ ] Dispatch remains disabled if setup is cancelled and snoozed.
- [ ] Enabling dispatch works.
- [ ] One built-in `task` opens the picker and selection overrides the model.
- [ ] Multiple parallel `task` calls batch into one picker.
- [ ] Apply-to-all and per-row selections both work.
- [ ] Child sessions show original agent names in TUI/Desktop history.
- [ ] Technical picker failure falls back to built-in task default/current model with warning.
- [ ] Explicit cancel starts no subagents.
- [ ] Archiving child sessions triggers shadow cleanup.
- [ ] Any failed hard gate or manual check is documented before release continues.

## Evidence

Record the OpenCode version, plugin package/tarball, picker asset path, scratch project path, date, operator, and pass/fail notes here when the gate is run.

## Release Decision

Release is blocked until every checklist item is checked or the failed item is documented with the required upstream/API follow-up.
