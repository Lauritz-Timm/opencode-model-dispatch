# 0007 Batch Coordinator

Parent: `docs/plan.md`

What to build: Implement the session-scoped task batching coordinator that groups near-simultaneous task calls, resolves each waiter independently, and preserves fallback/cancel semantics.

Acceptance criteria:
- Groups task calls by session and debounce window using default `500 ms`.
- Resolves all waiters in a batch with selections.
- Cancels all waiters on picker cancel.
- On technical failure, marks fallback and leaves original args unchanged.
- Preserves original concurrency by resolving all waiters independently.
- Tests cover grouping, independent resolution, cancel, technical failure, and session isolation.

Blocked by: -
