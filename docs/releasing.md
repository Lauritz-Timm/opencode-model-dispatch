# Releasing

This document is for maintainers. The release process is deliberately
fail-closed because one npm package contains the plugin and prebuilt native
picker binaries for every supported platform.

## Before the Release Candidate

- Update `CHANGELOG.md`.
- Keep `package.json`, `picker/package.json`, and
  `picker/src-tauri/Cargo.toml` versions synchronized.
- After the rolling OpenCode compatibility workflow passes, update every exact
  runtime version it tested in `docs/compatibility.md` to the release version
  and append newly tested versions. Preserve older rows and archive versions
  leaving the rolling window with their last verified plugin release.
- Regenerate and verify third-party notices after dependency changes.
- Confirm the required repository protections before storing or using signing
  or publishing credentials.

Run the local preflight without privileged tokens:

```sh
bun run release:preflight
```

Run the public repository check as a separate process:

```sh
bun run check:public-repo
```

The source preflight requires a clean tracked tree and does not require all
cross-platform binaries in a developer checkout. Use
`bun run release:artifact-preflight` only when all five generated picker assets
have deliberately been staged for inspection.

## Manual Integration Evidence

Complete `docs/manual-integration-gate.md` from the exact intended source
commit. Record its full `git rev-parse HEAD`, the tested tarball, and the TUI
and Desktop results.

Commit only the completed evidence file on a branch based on that source
commit. Merge it through protected `main`, confirm that the merged commit
differs from the tested source only by the evidence file, and wait for CI on
the exact merged SHA. If `main` moves first, rerun the gate from the new
candidate.

## Tagging

The release tag must be exactly `v<package version>` and point at the current
`origin/main`. Create and push it only after the manual evidence merge and its
exact-SHA CI run succeed.

The tagged workflow verifies source state and ancestry before it:

1. Builds and Rust-tests Linux x64/ARM64, macOS ARM64, and Windows x64/ARM64
   picker artifacts.
2. Exercises the real picker protocol and installed npm package on runnable
   targets.
3. Signs and notarizes macOS and Authenticode-signs Windows artifacts in fresh
   jobs that do not check out repository source.
4. Packs one exact npm tarball from the validated artifacts.
5. Publishes npm, verifies registry integrity and provenance, then publishes
   the staged GitHub release with checksums and notices.

A retried workflow reuses the verified, commit-bound assets in its staged draft
release. Do not edit or delete that draft while recovering a failed release;
substituted assets fail attestation verification.

## Repository Protection

Before adding any release credential, enable:

- immutable GitHub releases;
- private vulnerability reporting;
- Dependabot security updates;
- required CI and deletion/force-push protection on `main`;
- an active `refs/tags/v*` ruleset that restricts create, update, and delete.

Only the repository owner should be an always-allowed bypass actor for release
tag creation. Do not grant a broad repository role bypass.

Repository protection is a mandatory local pre-tag gate. The tagged workflow
contains no repository-administration token.

`check:public-repo` uses `GITHUB_REPOSITORY_SETTINGS_TOKEN` only in the local,
standalone gate. Use a short-lived fine-grained token scoped to this repository
with Administration read/write because GitHub omits ruleset bypass actors from
less privileged responses. Use a separate read-only `GITHUB_TOKEN` for the
exact-SHA Actions lookup. Do not pass either token to `release:preflight`, store
the administration token in Actions, or reuse it for publishing or signing.
Revoke it before pushing the release tag.

## First npm Publish

Because npm trusted publishing cannot be configured before the package exists,
the first release uses a short-lived granular access token:

1. Set package scope to `All packages` because the new package cannot be
   selected before its first publish. Grant `Read and write`, select the
   shortest practical expiry, and enable the required 2FA bypass for
   automation.
2. Store it as `NPM_BOOTSTRAP_TOKEN` in a protected `npm-bootstrap` GitHub
   environment with maintainer approval.
3. Push the release tag. The workflow exposes the token only to the isolated
   bootstrap job and only when the package name itself returns npm `E404`.
4. Configure npm trusted publishing for
   `Lauritz-Timm/opencode-model-dispatch`, workflow `publish.yml`, with no
   environment.
5. Revoke the bootstrap token, delete the Actions secret, require 2FA, and
   disallow token publishing.

Subsequent releases use GitHub OIDC trusted publishing and require no npm
repository secret.

## Signing Secrets

Store the Apple credentials only as environment secrets in the protected
`release-signing-macos` GitHub environment:

- `APPLE_CERTIFICATE` (base64 P12)
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_SIGNING_IDENTITY`
- `APPLE_KEYCHAIN_PASSWORD`
- `APPLE_API_PRIVATE_KEY` (base64 P8)
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER_ID`

Store the Windows credentials only as environment secrets in the protected
`release-signing-windows` GitHub environment:

- `WINDOWS_CERTIFICATE` (base64 PFX)
- `WINDOWS_CERTIFICATE_PASSWORD`

Require maintainer approval on both signing environments. Do not also define
these credentials as repository-level secrets.

`NPM_BOOTSTRAP_TOKEN` exists for the first publish only.

## Recovery

- A failed local or manual gate requires a fix and a fresh run from the new
  source commit.
- A tag must not move. Fix the cause and create the next version if publication
  has crossed an irreversible registry boundary.
- Do not replace staged signed assets during a retry.
- Treat npm integrity, signature, provenance, or source-ancestry mismatches as
  release blockers, not warnings.
