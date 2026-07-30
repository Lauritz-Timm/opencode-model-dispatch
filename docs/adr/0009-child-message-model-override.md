# ADR 0009: Child Message Model Override

## Context

The original shadow-agent design attempted to add an agent from
`tool.execute.before`. OpenCode invokes a plugin's `config` hook once during
startup and then builds its agent registry from that configuration. A shadow
created later cannot be resolved by the built-in `task` tool.

OpenCode creates the child session before it saves the child user message. The
documented `chat.message` hook receives that message, including its model, before
OpenCode persists or executes it.

## Decision

Keep `subagent_type` unchanged and queue each selected model by parent session
and original agent. When `chat.message` receives a child session, resolve its
parent through the SDK and apply the queued model to the child user message.
OpenCode 1.18.7 does not expose the originating task `callID` on that hook or
on the child session, so concurrent intercepted calls to the same agent are
released in FIFO order: the next built-in task does not start until the current
child message has consumed its selection.
Persist that selection through OpenCode's session model endpoint so later turns
use the same model, and update the built-in task result metadata after the
message has consumed the correlated selection.

An explicit provider-advertised effort variant is applied and persisted with
the model. `Auto` omits the variant: it preserves the existing variant when the
model is unchanged and otherwise lets the newly selected model use its normal
default.

## Consequences

- The built-in `task` implementation remains responsible for permissions,
  session creation, execution, cancellation, and output.
- Child history retains the original agent identity without temporary config.
- Subsequent child turns keep the selected model instead of reverting to the
  parent's original model.
- Explicit effort follows the selected model, while `Auto` avoids imposing a
  plugin-specific default.
- No persistent shadow-agent cache or cleanup is required.
- The integration is pinned and tested against the supported OpenCode plugin
  and SDK contract. A change to child-message hook timing is a compatibility
  break and must fail the live release gate.
- The FIFO gate prevents intercepted same-agent task calls from swapping
  selections. OpenCode does not currently provide enough pre-prompt identity to
  distinguish an unrelated same-parent/same-agent child created outside that
  queue; exact correlation requires an upstream child `parentCallID` (or an
  equivalent pre-prompt hook field).
