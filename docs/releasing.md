# Releasing

This document is for maintainers. The release process is deliberately
fail-closed because one npm package contains the plugin and prebuilt native
picker binaries for every supported platform.

## Before the Release Candidate

- Update `CHANGELOG.md`.
- Keep `package.json`, `picker/package.json`,
  `picker/src-tauri/tauri.conf.json`, `picker/src-tauri/Cargo.toml`, and the
  picker package entry in `picker/src-tauri/Cargo.lock` synchronized.
- After the rolling OpenCode compatibility workflow passes, update every exact
  runtime version it tested in `docs/compatibility.md` to the release version
  and append newly tested versions. Preserve older rows and archive versions
  leaving the rolling window with their last verified plugin release.
- Regenerate and verify third-party notices after dependency changes.
- Confirm the required repository protections before storing or using signing
  or publishing credentials.

After the intended source candidate is merged to `main` and equals
`origin/main`, run the automated candidate preflight without privileged
tokens:

```sh
bun run release:candidate-preflight
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

Prepare one retained local-host candidate artifact before opening either
surface:

```sh
bun run release:manual-candidate
```

The command fails unless the tracked and untracked source is clean and
`HEAD == origin/main`. It builds both plugin and local picker, stages only that
fresh host picker, packs the result without lifecycle scripts, and writes:

- `.manual-release/opencode-model-dispatch-<version>.tgz`;
- `.manual-release/manual-candidate.json`.

The metadata is commit-bound and records the tarball SHA-512 SRI and picker
SHA-256. `.manual-release/` is intentionally ignored by Git, but do not delete,
rebuild, repack, or replace it until both live surfaces have passed.

On Linux, exercise the retained bytes through both automated real-OpenCode
paths:

```sh
bun run release:manual-candidate:test
bun run release:manual-candidate:test:tui
```

Then create one empty temporary project and install that exact tarball for the
human TUI and Desktop checks:

```sh
manual_scratch="$(mktemp -d -t opencode-model-dispatch-release-XXXXXX)"
bun run release:manual-candidate:install -- --project "$manual_scratch"
```

The installer exposes only the retained candidate and its locked local
dependency graph through a temporary loopback registry. It runs
`opencode plugin opencode-model-dispatch@<version>` in the empty project,
confirms the tarball was fetched, and removes the registry override before the
live checks. Start the TUI in `$manual_scratch`, then fully quit it and open the
same directory in OpenCode Desktop. Copy the five printed evidence values into
the gate and sanitize the project path as documented there.

Commit only the completed evidence file on a branch based on that source
commit. Merge it through protected `main`, confirm that the merged commit
differs from the tested source only by the evidence file, and wait for CI on
the exact merged SHA. If `main` moves first, rerun the gate from the new
candidate.

From that clean merged SHA, run the final local pre-tag preflight:

```sh
bun run release:preflight
```

Rerun `bun run check:public-repo` from the same exact merged SHA so its
repository-settings and successful push-CI evidence apply to the commit that
will be tagged. Revoke the short-lived administration token after this final
check and before pushing the tag.

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
   environment, and select the allowed action `npm publish`.
5. Revoke the bootstrap token, delete the Actions secret, require 2FA, and
   disallow token publishing.

Subsequent releases use GitHub OIDC trusted publishing and require no npm
repository secret.

## Signing Configuration

Store the Apple credentials only as environment secrets in the protected
`release-signing-macos` GitHub environment:

- `APPLE_CERTIFICATE` (base64 P12)
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_SIGNING_IDENTITY`
- `APPLE_KEYCHAIN_PASSWORD`
- `APPLE_API_PRIVATE_KEY` (base64 P8)
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER_ID`

`APPLE_API_PRIVATE_KEY`, `APPLE_API_KEY_ID`, and `APPLE_API_ISSUER_ID` must
belong to an App Store Connect **Team API key**. An individual API key cannot
be used with `notarytool`. The Account Holder must first request App Store
Connect API access, and an Account Holder or Admin must create the team key.
Keep the downloaded P8 private key as carefully as the Developer ID P12. See
Apple's [API key documentation][apple-api-keys] and
[team-key setup guide][apple-team-keys].

Windows signing uses [Azure Artifact Signing][azure-signing] with GitHub OIDC.
The private signing key remains in Microsoft's HSM-backed service; do not add a
PFX, Azure client secret, or other long-lived Windows signing secret to
GitHub. The cloud signing job receives only the release executable. Runtime
model selection, prompts, and OpenCode sessions remain local.

Before creating the Azure resources, confirm the current eligibility rules. As
of July 2026, Public Trust accepts organizations in the EU, including a
qualifying Danish legal organization, but individual developers are accepted
only in the United States and Canada. It also requires a paid Azure
subscription whose billing identity matches the certificate subject. Do not
push a release tag until identity validation is complete and the certificate
profile is active. See Microsoft's
[eligibility quickstart][azure-quickstart] and
[current pricing documentation][azure-pricing]. If the publisher is not
eligible, select another HSM-backed public-trust provider in a reviewed
workflow change; never fall back to unsigned Windows binaries.

Create an Entra application/service principal and give it only the
`Artifact Signing Certificate Profile Signer` role at the certificate-profile
scope. Add a federated credential with:

- issuer `https://token.actions.githubusercontent.com`;
- audience `api://AzureADTokenExchange`;
- the exact environment-bound repository subject ending in
  `:environment:release-signing-windows`.

Enable GitHub's [immutable OIDC subject][github-immutable-oidc] before creating
that federated credential, then read the repository setting back and use the
exact returned `sub_claim_prefix`. For this repository, the expected immutable
subject is:

```text
repo:Lauritz-Timm@269186225/opencode-model-dispatch@1290427988:environment:release-signing-windows
```

Do not assume the displayed value: verify it after opt-in before copying it to
Entra. Store these identifiers as environment variables in the protected
`release-signing-windows` GitHub environment:

- `AZURE_CLIENT_ID`
- `AZURE_TENANT_ID`
- `AZURE_SUBSCRIPTION_ID`
- `AZURE_ARTIFACT_SIGNING_ENDPOINT`
- `AZURE_ARTIFACT_SIGNING_ACCOUNT_NAME`
- `AZURE_ARTIFACT_SIGNING_CERTIFICATE_PROFILE_NAME`
- `EXPECTED_WINDOWS_SIGNER_SUBJECT`

`AZURE_ARTIFACT_SIGNING_ENDPOINT` must be the root HTTPS endpoint ending in
`.codesigning.azure.net`. Set `EXPECTED_WINDOWS_SIGNER_SUBJECT` to the exact
X.500 subject emitted by the active certificate profile. The workflow rejects
an already-signed input, signs both x64 and ARM64 files from a supported x64
Windows runner, and then verifies PE architecture, public trust, the exact
subject, and the RFC 3161 timestamp. Azure certificate thumbprints rotate, so
do not pin a thumbprint.

Require maintainer approval on both signing environments. Do not also define
the Apple credentials or Windows configuration at repository level.

`NPM_BOOTSTRAP_TOKEN` exists for the first publish only.

[apple-api-keys]: https://developer.apple.com/documentation/appstoreconnectapi/creating-api-keys-for-app-store-connect-api
[apple-team-keys]: https://developer.apple.com/help/app-store-connect/get-started/app-store-connect-api
[azure-signing]: https://learn.microsoft.com/en-us/azure/artifact-signing/overview
[azure-quickstart]: https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart
[azure-pricing]: https://learn.microsoft.com/en-us/azure/artifact-signing/how-to-change-sku
[github-immutable-oidc]: https://docs.github.com/en/actions/reference/security/oidc#immutable-subject-claims

## Recovery

- A failed local or manual gate requires a fix and a fresh run from the new
  source commit.
- A tag must not move. Fix the cause and create the next version if publication
  has crossed an irreversible registry boundary.
- Do not replace staged signed assets during a retry.
- Treat npm integrity, signature, provenance, or source-ancestry mismatches as
  release blockers, not warnings.
