import { describe, expect, test } from "bun:test"

import {
  cargoLockPackageVersion,
  cargoManifestVersion,
  releaseVersionFailures,
  type ReleaseVersionEntry,
} from "../scripts/check-release-version"

function entries(version = "0.1.0"): ReleaseVersionEntry[] {
  return [
    { label: "package.json", version },
    { label: "picker/package.json", version },
    { label: "picker/src-tauri/tauri.conf.json", version },
    { label: "picker/src-tauri/Cargo.toml", version },
    { label: "picker/src-tauri/Cargo.lock", version },
    { label: "picker/public/assets/manifest.json", version },
  ]
}

describe("release version check", () => {
  test("accepts synchronized non-placeholder versions and the matching tag", () => {
    expect(releaseVersionFailures(entries(), "v0.1.0")).toEqual([])
  })

  test("rejects manifest drift, placeholder versions, and tag drift", () => {
    const drifted = entries()
    drifted[2] = {
      label: "picker/src-tauri/tauri.conf.json",
      version: "0.2.0",
    }

    expect(releaseVersionFailures(drifted, "v0.1.1")).toEqual([
      "picker/src-tauri/tauri.conf.json version 0.2.0 must match package.json version 0.1.0",
      "release tag v0.1.1 must equal v0.1.0",
    ])
    expect(releaseVersionFailures(entries("0.0.0"))).toContain(
      "package.json version must not be the unreleasable placeholder 0.0.0",
    )
    expect(releaseVersionFailures(entries("0.2.0-rc.1"), "v0.2.0-rc.1"))
      .toContain(
        "package.json version must be a stable semver; prereleases require an explicit npm dist-tag policy",
      )
  })

  test("reads the package versions from Cargo manifests and locks", () => {
    expect(
      cargoManifestVersion(`
[package]
name = "opencode-model-dispatch-picker"
version = "0.1.0"

[dependencies]
tauri = "2"
`),
    ).toBe("0.1.0")
    expect(
      cargoLockPackageVersion(
        `
[[package]]
name = "another-package"
version = "9.0.0"

[[package]]
name = "opencode-model-dispatch-picker"
version = "0.1.0"
dependencies = []
`,
        "opencode-model-dispatch-picker",
      ),
    ).toBe("0.1.0")
  })
})
