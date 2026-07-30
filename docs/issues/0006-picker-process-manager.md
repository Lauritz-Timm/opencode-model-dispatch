# 0006 Picker Process Manager

Parent: [`PRODUCT.md`](../../PRODUCT.md)

What to build: Implement the plugin-side picker process manager that launches
the platform picker binary, connects JSON-RPC stdio, waits for the
`ready`/`start`/`started` handshake, and classifies cancel versus technical
failure.

Acceptance criteria:
- Starts the platform picker binary and waits for `ready`, then sends `start`
  and waits for `started`.
- Resolves bundled picker binary path per platform.
- Applies startup/connect timeout default `20000`.
- Treats missing binary, timeout, crash, lost stdio, and invalid payload as technical failures.
- Treats observed cancel as cancel even if the process exits afterward.
- Applies a separate 10-minute decision timeout after `started`.
- Bounds inbound and outbound JSON-RPC lines at 4 MiB and terminates the child
  process on every technical transport failure.
- Tests cover successful launch, both timeouts, missing binary, crash, invalid
  or oversized payload, lost stdio, process termination, and cancel precedence.

Blocked by: 0005
