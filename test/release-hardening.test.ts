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
  test("GitHub JavaScript actions use SHA-pinned Node 24 releases", async () => {
    const workflows = await Promise.all([
      readText(".github/workflows/ci.yml"),
      readText(".github/workflows/compatibility.yml"),
      readText(".github/workflows/publish.yml"),
    ])
    const combined = workflows.join("\n")

    expect(combined).not.toContain(
      "actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
    )
    expect(combined).not.toContain(
      "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
    )
    expect(combined).not.toContain(
      "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
    )
    expect(combined).not.toContain(
      "actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093",
    )

    for (const workflow of workflows) {
      const actionRefs = [...workflow.matchAll(/uses:\s+([^\s]+)/g)]
        .map((match) => match[1])
      for (const ref of actionRefs) {
        if (ref?.startsWith("actions/checkout@")) {
          expect(ref).toBe(
            "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
          )
        }
        if (ref?.startsWith("actions/setup-node@")) {
          expect(ref).toBe(
            "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
          )
        }
        if (ref?.startsWith("actions/upload-artifact@")) {
          expect(ref).toBe(
            "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
          )
        }
        if (ref?.startsWith("actions/download-artifact@")) {
          expect(ref).toBe(
            "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c",
          )
        }
      }

      const setupNodeCount = workflow.match(/actions\/setup-node@/g)?.length ?? 0
      const cacheDisabledCount =
        workflow.match(/package-manager-cache: false/g)?.length ?? 0
      expect(cacheDisabledCount).toBe(setupNodeCount)
    }
  })

  test("public-repository gate requires every supported picker target check", () => {
    const pickerChecks = REQUIRED_CI_CHECK_CONTEXTS.filter((context) =>
      context.startsWith("Picker build ("),
    )

    expect(pickerChecks).toEqual([
      "Picker build (Linux x64)",
      "Picker build (Linux ARM64)",
      "Picker build (macOS ARM64)",
      "Picker build (Windows x64)",
      "Picker build (Windows ARM64)",
    ])
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
