# 0017 Manual OpenCode Integration Gate

Parent: [`PRODUCT.md`](../../PRODUCT.md)

What to build: Run the final manual integration gate against a local OpenCode instance in a scratch project, validating the complete plugin, picker, setup, dispatch, batching, failure, display-name, model-persistence, signing, and publishing behavior before release.

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
- Subsequent child turns and task metadata retain the selected model.
- Native close behaves as explicit cancel.
- TUI/Desktop evidence is recorded for the exact release-candidate commit;
  signing and checksums remain automated workflow gates, while repository
  security is verified by the separate local pre-tag gate.
- Every hard gate passes; a failed check blocks release until fixed and rerun.

Blocked by: 0011, 0012, 0016
