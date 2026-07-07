# opencode-model-dispatch Design Context

## Visual Direction

The picker should resemble an OpenCode native modal or command palette: compact, dark by default, token-driven, and focused on rows of actionable choices. The UI should feel like it belongs inside the OpenCode desktop app.

## Theme

Use bundled OpenCode theme tokens and resolved OpenCode CSS variables as the source of truth. Default to the active runtime theme hint when available, then URL overrides for previews, then fixture defaults.

## Typography

- Base text: compact product UI scale around 12px to 13px.
- Row titles: slightly stronger, around 13px to 14px.
- Metadata and helper text: 11px to 12px, muted.
- Avoid large marketing-style page headings in the picker.

## Layout

- Picker window should be compact enough to feel modal-like, approximately 680px wide by 500px tall in preview.
- Use tight row spacing, hairline borders, and restrained surfaces.
- Prefer a command-palette structure: small title area, dense list, concise footer actions.
- Settings can remain structurally similar but should use smaller fonts and sizing so it fits a smaller window comfortably.

## Interaction

- Escape cancels.
- Enter submits when the selection is valid.
- Focus, hover, disabled, and selected states must be visible and OpenCode-like.
- Native browser controls are acceptable only if styled to fit the surrounding OpenCode surface.

## Motion

Keep motion minimal and functional. Avoid decorative animation.
