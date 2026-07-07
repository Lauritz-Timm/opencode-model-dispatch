# opencode-model-dispatch Design Context

## Visual Direction

The picker runs as the plugin's own UI, but should visually match OpenCode as closely as possible. It should resemble an OpenCode modal or command palette: compact, token-driven, keyboard-first, and focused on rows of actionable choices.

The visual test is simple: even though it is a separate plugin UI, it should look like a close OpenCode companion surface rather than a generic browser-based app.

## Theme

Use bundled OpenCode theme tokens and resolved OpenCode CSS variables as the source of truth. Default to the active runtime theme hint when available, then URL overrides for previews, then fixture defaults.

Prefer the host theme over custom color invention. Any custom color should be a subtle state treatment derived from OpenCode tokens, not a separate brand palette.

## Typography

- Base text: compact product UI scale around 12px to 13px.
- Row titles: slightly stronger, around 13px to 14px.
- Metadata and helper text: 11px to 12px, muted.
- Avoid large marketing-style page headings in the picker.
- Use short labels and OpenCode-like terminology. Avoid explanatory prose when a command label or concise helper line is enough.

## Layout

- Picker window should be compact enough to feel modal-like, approximately 680px wide by 500px tall in preview.
- Use tight row spacing, hairline borders, and restrained surfaces.
- Prefer a command-palette structure: small title area, dense list, concise footer actions.
- Settings can remain structurally similar but should use smaller fonts and sizing so it fits a smaller window comfortably.
- Avoid dashboard composition, marketing sections, card grids, and roomy form layouts.

## Interaction

- Escape cancels.
- Enter submits when the selection is valid.
- Focus, hover, disabled, and selected states must be visible and OpenCode-like.
- Native browser controls are acceptable only if styled to fit the surrounding OpenCode surface.
- Keyboard flow should be as important as pointer flow. Tab order, selected-row state, and submit/cancel actions should be predictable without reading instructions.

## Motion

Keep motion minimal and functional. Avoid decorative animation.
