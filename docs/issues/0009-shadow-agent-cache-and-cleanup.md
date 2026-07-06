# 0009 Shadow-Agent Cache And Cleanup

Parent: `docs/plan.md`

What to build: Implement persistent shadow-agent lifecycle state and cleanup rules so shadow agents remain available for active child sessions and are removed when orphaned, archived, missing, or stale.

Acceptance criteria:
- Stores `callID -> shadowKey` before task execution.
- Updates `shadowKey -> childSessionID` from task metadata after task execution.
- Dispose removes only orphaned shadows without child session ids.
- `session.updated` with `time.archived` removes mapped shadow.
- Startup garbage collection removes stale orphans and mapped shadows whose child session is archived or missing.
- Stores cache under the user's OpenCode/plugin cache area, not the project repo.
- Tests cover call mapping, child-session mapping, dispose cleanup, archive cleanup, and startup GC.

Blocked by: 0008
