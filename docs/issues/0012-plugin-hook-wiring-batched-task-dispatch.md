# 0012 Plugin Hook Wiring: Batched Task Dispatch

Parent: `docs/plan.md`

What to build: Wire batched task dispatch into the plugin hooks so multiple task calls in the same session/debounce window share one picker decision while each call continues independently after selection.

Acceptance criteria:
- Enabled dispatch groups task calls by session and batch window.
- One picker request represents all calls in the batch.
- Per-row selections create per-call shadow agents.
- Apply-to-all selection applies the selected model to every task row.
- All waiters resolve independently and preserve original concurrency.
- Tests cover multiple parallel calls, per-row selections, apply-to-all, and separate sessions/batches.

Blocked by: 0007, 0010
