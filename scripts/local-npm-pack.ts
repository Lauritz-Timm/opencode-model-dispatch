import { randomUUID } from "node:crypto"
import { cp, mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

const npmPackLifecycleScripts = ["prepack", "prepare", "postpack"] as const

export async function stageLifecycleNeutralPackage(
  packageRoot: string,
  stageRoot: string,
  manifest: Record<string, unknown>,
): Promise<string> {
  const name = readString(manifest, "name")
  const version = readString(manifest, "version")
  assert(name && version, "Staged local dependency omitted name or version")

  await mkdir(stageRoot, { recursive: true })
  const stagedPackageRoot = join(stageRoot, randomUUID())
  await cp(packageRoot, stagedPackageRoot, {
    recursive: true,
    force: false,
    errorOnExist: true,
  })

  // npm 10 runs pack lifecycle hooks for directory arguments even when passed
  // --ignore-scripts. Preserve all other package metadata while removing only
  // the hooks npm pack itself can execute from this disposable manifest.
  const stagedManifest = { ...manifest }
  const scripts = asRecord(manifest.scripts)
  if (scripts) {
    const stagedScripts = { ...scripts }
    for (const script of npmPackLifecycleScripts) {
      delete stagedScripts[script]
    }
    if (Object.keys(stagedScripts).length > 0) {
      stagedManifest.scripts = stagedScripts
    } else {
      delete stagedManifest.scripts
    }
  }
  await writeFile(
    join(stagedPackageRoot, "package.json"),
    `${JSON.stringify(stagedManifest, null, 2)}\n`,
    "utf8",
  )
  return stagedPackageRoot
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function readString(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  const candidate = value[key]
  return typeof candidate === "string" ? candidate : undefined
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
