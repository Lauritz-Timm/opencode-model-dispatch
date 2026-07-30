# 0005 Picker JSON-RPC Protocol Contract

Parent: [`PRODUCT.md`](../../PRODUCT.md)

Status: implemented with the catalog-at-launch v1 protocol. Earlier live
validation/refresh method names are superseded by ADR 0005.

What to build: Implement the stdin/stdout NDJSON JSON-RPC protocol shared by
the plugin and picker, including framing, parse failures, lifecycle, and v1
method names.

Acceptance criteria:
- Encodes and decodes one JSON-RPC notification per line.
- Handles parse errors as technical failures with debug reason.
- Supports `ready`, `start`, `started`, `submit`, and `cancel`.
- Treats parent stdin EOF, process exit, start-write failure, and lost stdio as
  explicit lifecycle outcomes.
- Contract tests verify framing compatibility with a picker-like harness.

Blocked by: -
