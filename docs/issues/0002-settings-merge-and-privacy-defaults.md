# 0002 Settings Merge And Privacy Defaults

Parent: `docs/plan.md`

What to build: Implement the settings layer for global and project `model-dispatch.json` files, including default values, deep merge behavior, corrupt-config handling, and global-only privacy settings.

Acceptance criteria:
- Reads global and project `model-dispatch.json` settings.
- Deep merges `dispatch` settings.
- Keeps `privacy.logging_enabled` global-only.
- Defaults to `dispatch.enabled: false`, `batch_ms: 500`, `picker_timeout_ms: 20000`, and `technical_failure: "default_model"`.
- Supports `setup.snoozed_until` and 24-hour setup snooze.
- Corrupt settings return defaults plus a warning.
- Tests cover settings reads, writes, decoding, merging, defaults, and corrupt input.

Blocked by: -
