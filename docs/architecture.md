# Architecture

`opencode-model-dispatch` is an OpenCode plugin that pauses built-in subagent
dispatches long enough for the user to choose a model. It preserves OpenCode's
normal task lifecycle and adds one local decision surface: a bundled native
picker.

This is a living description of the current design. Update it when the design
changes; historical proposals belong in Git history, not in separate decision
records.

## Goals

- Let users choose a model and optional provider-advertised effort for each
  built-in `task` call.
- Batch calls started close together into one quick, keyboard-first decision.
- Preserve the requested agent, task arguments, OpenCode permissions, child
  session behavior, and task output.
- Keep prompts and workspace content outside the picker and operational logs.
- Ship a native picker without requiring users to install Rust or Tauri.

## Non-goals

- Replacing OpenCode's `task` tool or implementing a separate agent runner.
- Maintaining a second provider or model configuration.
- Sending inference traffic, telemetry, analytics, or update requests.
- Predicting future sequential task calls.
- Reproducing OpenCode's UI exactly across every host and platform.

## Runtime Flow

```text
OpenCode task call
      │
      ▼
tool.execute.before ── disabled ───────────────► built-in task
      │ enabled
      ▼
session-scoped debounce batch
      │
      ├── OpenCode SDK: models, agents, parent model
      ▼
bundled picker process ◄── NDJSON-RPC ──► Tauri + Svelte UI
      │
      ├── cancel ─────────► no calls start
      ├── technical error ► warning + OpenCode fallback
      ▼
selected model queued by parent session and agent
      │
      ▼
built-in task creates child session
      │
      ▼
chat.message applies and persists selected model
      │
      ▼
tool.execute.after reports model in task metadata
```

## Components

### Plugin runtime

`src/index.ts` composes the OpenCode hooks and owns the end-to-end dispatch
flow. It deliberately leaves the original `task` arguments unchanged.

`src/batcher.ts` groups calls by parent session during a configurable debounce
window. Batches for one session are dispatched in order; different sessions
remain independent.

`src/model-catalog.ts` shapes the enabled OpenCode provider catalog for the
picker. Agent defaults take precedence over the latest parent model for row
preselection. A hidden configured model may remain visible on its affected row,
but is not added to the apply-to-all catalog.

`src/picker-process.ts` and `src/picker-rpc.ts` resolve the native binary,
manage its lifecycle, and enforce the picker protocol and size limits.

`src/settings.ts` and `src/setup.ts` read, validate, merge, and write global and
project configuration. Invalid or unsafe configuration returns defaults with a
warning.

`src/loopback-transport.ts` protects the extra client used to persist a selected
child-session model. It permits loopback HTTP only, rejects redirects, and
revalidates endpoints.

### Native picker

`picker/src-tauri/` is a small native host. It bridges process stdio to the
webview and owns native window behavior.

`picker/src/` contains the Svelte UI. Selection and setup behavior is kept in
pure reducers and validators so it can be tested independently from rendering.
The picker receives model metadata and call identity, never task prompts or
descriptions.

The theme resolver uses bundled OpenCode theme sources. Runtime theme hints
take precedence, followed by explicit preview parameters and fixture defaults.

### Build and release tooling

`scripts/` builds the ESM package and native picker, verifies the npm payload,
tests an installed package, exercises a real local OpenCode server, and checks
release invariants. The npm package contains prebuilt picker binaries and uses
no install lifecycle scripts.

## Design Choices

### Intercept the built-in task

The plugin waits in `tool.execute.before` instead of adding a custom dispatch
tool. Agents continue using OpenCode's normal tool, so OpenCode remains
responsible for permissions, child creation, execution, cancellation, and
output.

### Override the child message, not the agent

OpenCode resolves its agent registry during startup, so a temporary agent
created when a task starts cannot reliably affect that task. The selected model
is queued instead and applied when the child session's first `chat.message`
hook runs. It is then persisted for later turns and copied to task metadata.

OpenCode does not currently expose the originating task call ID before that
child message. Calls with the same parent and agent are therefore released in
FIFO order so selections cannot swap. This serialization should remain until a
supported API provides exact correlation at the same point in the lifecycle.

### Debounce parallel work

Calls arriving within the configured window, `500 ms` by default, share one
picker. Calls that occur after an earlier task finishes form a new batch. This
gives parallel dispatches one interaction without trying to predict later work.

### Use an external Tauri picker

A bundled Tauri mini-window provides a focused native overlay for both the TUI
and Desktop without requiring changes to OpenCode core. The tradeoff is a
cross-platform build and signing matrix plus best-effort, rather than exact,
host integration.

### Keep IPC local and process-owned

The plugin and picker exchange newline-delimited JSON-RPC over stdio. The
lifecycle is:

1. Picker sends `ready`.
2. Plugin sends one bounded `start` request.
3. Picker sends `started` after the webview has hydrated the request.
4. Picker sends exactly one terminal `submit` or `cancel`.

Each line is capped at 4 MiB. Startup remains timed until `started`; an
abandoned picker is terminated after the separate decision timeout. Transport
errors terminate the child process. No network listener is opened.

### Follow OpenCode's model catalog

Provider, model, variant, agent, and parent-session data comes from the
OpenCode SDK. The plugin does not maintain a separate allowlist. Effort values
are limited to variants advertised by the selected model. `Auto` omits an
explicit variant, preserving a compatible existing value only when the model
does not change.

### Fail safely

User cancellation and technical failure are distinct:

- Cancellation starts no task in the affected batch.
- A technical picker or transport failure warns the user and leaves the task
  unchanged so OpenCode chooses its configured fallback model.

Invalid settings, duplicate call identity, oversized messages, unadvertised
variants, and unsafe persistence endpoints also fail into bounded, explicit
behavior rather than being accepted optimistically.

### Separate global trust from project configuration

Dispatch settings can be overridden per project. Privacy and appearance remain
global so repository-controlled files cannot enable logging or control local
theme behavior. Project settings symlinks are rejected, configuration files
are size-bounded, and setup handles `.gitignore` explicitly.

### Keep the control plane private

The picker sees call IDs, agent names, model metadata, and preselection only.
Logs contain bounded operational identifiers and failure categories. The
plugin has no hosted service, analytics, updater, or direct provider
connection. OpenCode's own provider requests remain outside this boundary.

## Picker Design

The picker should look like a close OpenCode companion surface: compact,
token-driven, keyboard-first, and quiet.

- Prefer OpenCode theme tokens over a custom palette.
- Use a dense command-palette layout, restrained surfaces, and short labels.
- Keep base text around 12–13 px, titles around 13–14 px, and helper text
  around 11–12 px.
- Make focus, hover, selection, disabled state, and errors visible.
- Escape cancels. Enter submits only when every row has a valid selection.
- Keep settings secondary to model selection.
- Avoid dashboard layouts, marketing copy, decorative gradients, large
  headings, and decorative motion.
- Support keyboard-only use and never rely on color alone.

## Changing the Design

Before changing a boundary above, describe the current limitation and the new
invariant in the pull request. Update this document in the same change and add
tests at the narrowest useful level. Changes to OpenCode hook timing, picker
IPC, privacy boundaries, native packaging, or fallback semantics also require
the relevant installed-package or real OpenCode integration check.
