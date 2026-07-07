# opencode-model-dispatch Product Context

## Register

product

## Purpose

`opencode-model-dispatch` is an OpenCode plugin for model routing with its own UI surface. It intercepts OpenCode subagent task dispatches, batches near-simultaneous calls, and lets the user choose one model for all tasks or a different model per task before execution starts.

Success means the separate plugin UI looks and behaves very close to OpenCode itself: fast, keyboard-first, compact, and invisible once the routing decision is made.

## Users

Developers using OpenCode with multiple configured models and subagents. They are already in a focused coding session and need to make a fast routing decision without losing context or switching mental modes.

They expect the plugin's own UI to mirror OpenCode's interaction model, theme, density, and terminology rather than behaving like a separate browser app.

## Brand Personality

OpenCode-aligned, precise, quiet. The product should feel like a sharp developer tool: direct when it needs input, restrained everywhere else.

## Principles

- Treat OpenCode as the visual and interaction reference. The plugin runs its own UI, but should closely mirror OpenCode's language, density, theme tokens, and command-oriented behavior.
- Optimize for fast model selection, keyboard confidence, and clear cancellation.
- Avoid exposing task prompts or prompt-derived content in UI or logs.
- Treat the picker as a transient command surface, not a dashboard.
- Keep settings secondary and compact; the model picker is the primary release-critical surface.

## Anti-References

- SaaS cards, hero copy, marketing language, oversized headings.
- Bright decorative gradients or glass effects.
- Spacious web-form layouts that feel disconnected from OpenCode.
- UI that requires reading long explanatory copy before choosing models.
- Any styling that makes the plugin's own UI look like a generic webview instead of a close OpenCode companion surface.

## Accessibility & Inclusion

Support keyboard-only operation as a first-class path. Keep focus states visible, preserve clear cancel/submit affordances, and avoid relying on color alone to communicate selection or disabled states.
