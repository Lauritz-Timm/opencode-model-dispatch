# 0013 Setup And Configure UI Backend

Parent: `docs/plan.md`

What to build: Implement the backend flow for first-run setup and the user-requested `configure_model_dispatch` tool, reusing picker protocol/setup mode to read, write, snooze, reset, and scope settings.

Acceptance criteria:
- No config at plugin load opens setup unless snoozed.
- Setup cancel disables dispatch and snoozes for 24 hours.
- Setup snooze is written globally.
- Privacy/logging writes global only.
- Dispatch behavior writes global or project config based on user choice.
- Project config creates `.opencode/model-dispatch.json`.
- Git repo path offers checked-by-default gitignore option.
- If selected, `.opencode/model-dispatch.json` is added to `.gitignore` and the user is informed.
- Non-git project writes config and reports no gitignore update needed.
- Reset to defaults works.
- Tests cover first-run, snooze, global/project writes, gitignore behavior, non-git behavior, and reset.

Blocked by: 0002, 0005
