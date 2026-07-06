# ADR 0007: Settings, Setup, and Privacy

## Context

The plugin should be opt-in, configurable globally and per project, and safe for
privacy-sensitive users. Logging is useful for maintenance, but users must be
able to disable all plugin logging.

First-run setup should happen through the same Tauri shell so both TUI and
Desktop users get a consistent configuration experience.

## Decision

Use global and project settings files with deep merge for `dispatch` settings.

Privacy/logging settings are global only. `privacy.logging_enabled: false`
disables all plugin logging. First-run setup opens at plugin load when no config
exists, unless snoozed. If setup is cancelled, dispatch remains disabled and
setup is snoozed globally for 24 hours.

## Consequences

The plugin is inactive until explicitly enabled.

Project dispatch behavior can be configured without allowing project config to
override user privacy.

Setup can create project config and optionally add `.opencode/model-dispatch.json`
to `.gitignore`, but it must clearly inform the user what it changed.
