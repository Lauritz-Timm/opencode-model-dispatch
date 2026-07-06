# 0003 Privacy-Safe Logging

Parent: `docs/plan.md`

What to build: Implement structured plugin logging that records useful operational telemetry while excluding prompts, descriptions, user text, and other sensitive task details, with complete suppression when privacy logging is disabled.

Acceptance criteria:
- Success logs include only non-sensitive plugin telemetry.
- Failure logs include code, reason category, batch/call/session ids, platform, picker version, and IPC/process status.
- Prompts, descriptions, and user text are never logged.
- `privacy.logging_enabled: false` suppresses all plugin logs.
- User-facing warnings/errors are still returned when logging is disabled.
- Supports `MODEL_DISPATCH_CANCELLED` and `MODEL_DISPATCH_PICKER_FAILED` codes.

Blocked by: 0002
