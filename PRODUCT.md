# opencode-model-dispatch Product Context

## Register

Product UI. The interface serves a developer workflow inside OpenCode and should feel like a native extension of the host app, not like a standalone SaaS product.

## Purpose

`opencode-model-dispatch` intercepts OpenCode subagent task dispatches, batches near-simultaneous calls, and lets the user choose one model for all tasks or a different model per task before execution starts.

## Users

Developers using OpenCode with multiple configured models and subagents. They are already in a focused coding session and need to make a fast routing decision without losing context.

## Principles

- Match OpenCode's native desktop feel: compact, direct, token-driven, low ornament.
- Optimize for fast model selection, keyboard confidence, and clear cancellation.
- Avoid exposing task prompts or prompt-derived content in UI or logs.
- Treat the picker as a transient command surface, not a dashboard.
- Keep settings secondary and compact; the model picker is the primary release-critical surface.

## Anti-References

- SaaS cards, hero copy, marketing language, oversized headings.
- Bright decorative gradients or glass effects.
- Spacious web-form layouts that feel disconnected from OpenCode.
- UI that requires reading long explanatory copy before choosing models.
