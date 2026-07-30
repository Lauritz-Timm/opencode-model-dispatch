# 0004 Model Catalog And Preselection

Parent: [`PRODUCT.md`](../../PRODUCT.md)

What to build: Build the provider-grouped picker catalog from visible OpenCode models and derive per-task preselection from agent defaults or parent/current session model metadata.

Acceptance criteria:
- Builds provider-grouped picker catalog from visible SDK models.
- Preserves OpenCode provider/model order.
- Reads agent defaults from `client.app.agents()` model metadata.
- Finds parent/current model from latest assistant message via `client.session.messages()`.
- Preselects agent model first, then parent/current model.
- Includes only provider-advertised effort variants and preserves a supported
  configured variant in row preselection.
- Shows hidden configured/current preselect only on that row, not in apply-to-all.
- Provider icon resolves best-effort from metadata, bundled map, then initial.
- Tests cover catalog shaping, preselection, hidden model handling, and icon fallback.

Blocked by: 0001
