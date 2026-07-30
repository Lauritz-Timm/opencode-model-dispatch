import { describe, expect, test } from "bun:test"

import {
  releasePackageManifestFailures,
  releasePackageManifestFiles,
  releasePackageSurfaceFailures,
  releasePickerAssets,
} from "../scripts/check-packaging"
import { REQUIRED_CI_CHECK_CONTEXTS } from "../scripts/check-public-repository"

const root = new URL("../", import.meta.url)

async function readText(path: string): Promise<string> {
  return await Bun.file(new URL(path, root)).text()
}

function workflowJob(
  workflow: string,
  job: string,
  nextJob: string,
): string {
  const start = workflow.indexOf(`\n  ${job}:`)
  const end = workflow.indexOf(`\n  ${nextJob}:`, start + 1)
  if (start < 0 || end < 0) {
    throw new Error(`Could not isolate workflow job ${job}`)
  }
  return workflow.slice(start, end)
}

describe("release hardening", () => {
  test("public-repository gate requires the Linux ARM64 picker check", () => {
    expect(REQUIRED_CI_CHECK_CONTEXTS).toContain("Picker build (Linux ARM64)")
  })

  test("platform signing secrets are isolated behind protected environments", async () => {
    const workflow = await readText(".github/workflows/publish.yml")
    const macos = workflowJob(
      workflow,
      "picker-sign-macos",
      "picker-sign-windows",
    )
    const windows = workflowJob(
      workflow,
      "picker-sign-windows",
      "stage-release",
    )

    expect(macos).toContain("environment: release-signing-macos")
    expect(macos).toContain("secrets.APPLE_CERTIFICATE")
    expect(macos).not.toContain("secrets.WINDOWS_CERTIFICATE")

    expect(windows).toContain("environment: release-signing-windows")
    expect(windows).toContain("secrets.WINDOWS_CERTIFICATE")
    expect(windows).not.toContain("secrets.APPLE_CERTIFICATE")
  })

  test("npm release files and staged top-level paths are exact allowlists", () => {
    expect(releasePackageManifestFailures([
      ...releasePackageManifestFiles,
    ])).toEqual([])
    expect(releasePackageManifestFailures([
      ...releasePackageManifestFiles,
      ".",
    ])).toContain("package files must not contain unexpected .")

    const files = [
      { path: "package.json", mode: 0o644 },
      { path: "README.md", mode: 0o644 },
      { path: "LICENSE", mode: 0o644 },
      { path: "THIRD_PARTY_NOTICES.md", mode: 0o644 },
      { path: "dist/index.js", mode: 0o644 },
      { path: "dist/index.d.ts", mode: 0o644 },
      { path: "bin/picker.js", mode: 0o755 },
      ...releasePickerAssets.map((asset) => ({
        path: `bin/${asset.name}`,
        mode: asset.executable ? 0o755 : 0o644,
      })),
    ]
    expect(releasePackageSurfaceFailures([{ files }])).toEqual([])
    expect(releasePackageSurfaceFailures([{
      files: [...files, { path: "docs/private-notes.md", mode: 0o644 }],
    }])).toContain(
      "staged npm package must not contain unexpected docs/private-notes.md",
    )
    expect(releasePackageSurfaceFailures([{
      files: [...files, { path: "dist/../private-key.pem", mode: 0o644 }],
    }])).toContain(
      "staged npm package must not contain unexpected dist/../private-key.pem",
    )
  })
})
