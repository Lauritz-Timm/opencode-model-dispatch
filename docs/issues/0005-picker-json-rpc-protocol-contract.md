# 0005 Picker JSON-RPC Protocol Contract

Parent: `docs/plan.md`

What to build: Implement the persistent stdin/stdout NDJSON JSON-RPC protocol contract shared by the plugin and picker, including request/response framing, ids, parse failures, and v1 method names.

Acceptance criteria:
- Encodes and decodes NDJSON JSON-RPC request/response messages.
- Matches responses by id.
- Handles parse errors as technical failures with debug reason.
- Supports `ready`, `validateModel`, `refreshModels`, `submit`, `cancel`, and `log`.
- Reserves `resize`, `themeChanged`, and `focusChanged` without implementing live behavior.
- Contract tests verify framing compatibility with a picker-like harness.

Blocked by: -
