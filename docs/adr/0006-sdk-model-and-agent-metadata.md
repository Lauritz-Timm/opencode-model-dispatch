# ADR 0006: SDK-Owned Model and Agent Metadata

## Context

OpenCode already has configured providers, visible models, current/default
models, and agent-specific model defaults. Duplicating that model list in plugin
settings would create drift and extra configuration burden.

The plugin should use stable SDK/API for model and agent data. Theme matching is
the only accepted exception where direct OpenCode theme file reads are allowed.

## Decision

Use OpenCode SDK/API as the source of truth for model and agent metadata.

The picker model catalog must come from the same enabled/visible model list that
OpenCode's model picker uses. Agent defaults come from `client.app.agents()`.
Parent/current model preselection comes from the latest assistant message in the
parent session.

Reasoning effort is represented by OpenCode's provider-specific model
`variants`. The picker exposes only variants advertised for the selected model.
It labels the absence of an explicit variant as `Auto`, allowing OpenCode and
the provider to retain their normal default.

## Consequences

The picker reflects the user's existing OpenCode model setup without a separate
plugin shortlist.

Implementation must stop if stable SDK/API cannot provide the enabled/visible
model list.

Hidden configured/current preselected models can be shown only on their task row
and are not added to apply-to-all.
