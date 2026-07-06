# ADR 0003: Debounced Batch Selection

## Context

Agents can issue multiple `task` calls in the same assistant turn or nearly at
the same time. Those calls should be shown in one picker so the user can choose
one model for all or assign models per task. If the agent waits for one subagent
to finish before starting the next, there is no reliable way for the plugin to
know future calls are coming.

## Decision

Batch task calls that arrive within a 500 ms debounce window for the same parent
session.

The picker will show one apply-to-all control and one row per task. Parallel
calls continue with their original concurrency after the user confirms.
Sequential calls that happen after a prior task finishes become separate picker
batches.

## Consequences

Parallel subagent dispatches get a single model-selection interaction.

Single task calls wait up to 500 ms before the picker opens.

The design does not attempt to predict future sequential task calls.
