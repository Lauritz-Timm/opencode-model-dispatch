# Changelog

All notable changes to this project will be documented here.

## 0.1.0

- Add OpenCode task batching and per-child model selection.
- Add the native Tauri model picker and setup UI.
- Add npm packaging with platform picker binaries.
- Add installed-package, protocol, UI, coverage, and release checks.
- Persist selected child-session models for subsequent turns and task metadata.
- Add keyboard-complete model selection, native close cancellation, and
  scope-aware setup/reset behavior.
- Add provider-aware effort selection with a simple `Auto` default and only
  the variants advertised by each model.
- Add signed/notarized release gates, dependency auditing, third-party notices,
  and public-repository security metadata.
- Add a nightly OpenCode compatibility matrix covering the current minor and
  five prior lines, with an exact append-only version history and archived
  last-tested guarantees.
- Match the active local OpenCode theme, acknowledge rendered native startup,
  and keep failed picker decisions retryable.
- Keep the child-session persistence transport on loopback even across
  redirects, bound settings and picker IPC input, and terminate failed or
  abandoned picker processes.
