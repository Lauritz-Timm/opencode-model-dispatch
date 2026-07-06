# 0006 Picker Process Manager

Parent: `docs/plan.md`

What to build: Implement the plugin-side picker process manager that launches the platform picker binary, connects JSON-RPC stdio, waits for readiness, and classifies cancel versus technical failure.

Acceptance criteria:
- Starts platform picker binary and waits for `ready`.
- Resolves bundled picker binary path per platform.
- Applies startup/connect timeout default `20000`.
- Treats missing binary, timeout, crash, lost stdio, and invalid payload as technical failures.
- Treats observed cancel as cancel even if the process exits afterward.
- Keeps no active-window timeout after `ready`.
- Tests cover successful launch, timeout, missing binary, crash, invalid payload, lost stdio, and cancel precedence.

Blocked by: 0005
