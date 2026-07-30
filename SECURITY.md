# Security Policy

## Supported Versions

Security fixes are provided for the latest `0.1.x` release. Development
checkouts and older versions are unsupported.

| Version | Supported |
| --- | --- |
| latest `0.1.x` | Yes |
| `<0.1.0` | No |

## Reporting a Vulnerability

Please report vulnerabilities through a
[private GitHub security advisory](https://github.com/Lauritz-Timm/opencode-model-dispatch/security/advisories/new).
Do not open a public issue for a suspected vulnerability.

Do not include secrets, API keys, private prompts, or sensitive workspace data in
public issues.

## Privacy Expectations

The plugin does not send prompts, task descriptions, file contents, or model
responses to its picker or operational logs. `privacy.logging_enabled: false`
disables plugin logging while preserving local user-facing warnings.

The plugin and picker have no independent network egress, hosted backend,
analytics, or update service. Their control-plane communication is local
stdio/Tauri IPC plus the OpenCode client supplied by the host. The plugin's
additional child-session persistence client refuses non-loopback server URLs.
That client disables redirects and revalidates every request and response
endpoint so a loopback request cannot be redirected to another host.
Requests that OpenCode sends to a configured model provider are outside this
plugin boundary; use a local provider when inference must remain on-device.

## Dependency Audits

CI runs Bun's dependency audit for both JavaScript lockfiles and
`cargo-audit` 0.22.2 against the locked Rust dependency graph. Actionable
RustSec vulnerabilities fail CI.

The current Tauri Linux stack transitively uses GTK3/glib 0.18. RustSec
therefore also reports informational unmaintained-crate warnings and
RUSTSEC-2024-0429 (`glib::VariantStrIter`, patched in glib 0.20). This project
does not use that API directly, and resolving the transitive advisory requires
an upstream Tauri/WebKitGTK dependency migration. The warnings remain visible
in CI and are treated as tracked dependency debt rather than suppressed.
