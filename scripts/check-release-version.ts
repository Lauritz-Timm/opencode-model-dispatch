import { readFile } from "node:fs/promises"

type JsonManifest = {
  version?: unknown
}

export interface ReleaseVersionEntry {
  label: string
  version: string
}

const root = new URL("../", import.meta.url)
const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

export function releaseVersionFailures(
  entries: ReleaseVersionEntry[],
  releaseTag?: string,
): string[] {
  const failures: string[] = []
  const rootVersion = entries[0]?.version

  if (!rootVersion || !semverPattern.test(rootVersion)) {
    failures.push(`package.json version must be valid semver; received ${rootVersion ?? "missing"}`)
    return failures
  }
  if (rootVersion === "0.0.0") {
    failures.push("package.json version must not be the unreleasable placeholder 0.0.0")
  }
  if (rootVersion.split("+", 1)[0]?.includes("-")) {
    failures.push(
      "package.json version must be a stable semver; prereleases require an explicit npm dist-tag policy",
    )
  }

  for (const entry of entries.slice(1)) {
    if (entry.version !== rootVersion) {
      failures.push(`${entry.label} version ${entry.version} must match package.json version ${rootVersion}`)
    }
  }

  if (releaseTag && releaseTag !== `v${rootVersion}`) {
    failures.push(`release tag ${releaseTag} must equal v${rootVersion}`)
  }

  return failures
}

export function cargoManifestVersion(contents: string): string {
  let inPackageSection = false
  for (const line of contents.split(/\r?\n/)) {
    if (/^\s*\[package\]\s*$/.test(line)) {
      inPackageSection = true
      continue
    }
    if (/^\s*\[/.test(line)) {
      inPackageSection = false
      continue
    }
    if (!inPackageSection) continue
    const match = line.match(/^\s*version\s*=\s*"([^"]+)"\s*$/)
    if (match?.[1]) return match[1]
  }
  throw new Error("picker/src-tauri/Cargo.toml has no [package] version")
}

export function cargoLockPackageVersion(contents: string, packageName: string): string {
  for (const block of contents.split("[[package]]").slice(1)) {
    const name = block.match(/^\s*name\s*=\s*"([^"]+)"\s*$/m)?.[1]
    if (name !== packageName) continue
    const version = block.match(/^\s*version\s*=\s*"([^"]+)"\s*$/m)?.[1]
    if (version) return version
  }
  throw new Error(`picker/src-tauri/Cargo.lock has no ${packageName} package version`)
}

async function jsonVersion(path: string): Promise<string> {
  const manifest = JSON.parse(await readFile(new URL(path, root), "utf8")) as JsonManifest
  if (typeof manifest.version !== "string") throw new Error(`${path} has no string version`)
  return manifest.version
}

async function releaseVersionEntries(): Promise<ReleaseVersionEntry[]> {
  const cargoManifest = await readFile(
    new URL("picker/src-tauri/Cargo.toml", root),
    "utf8",
  )
  const cargoLock = await readFile(
    new URL("picker/src-tauri/Cargo.lock", root),
    "utf8",
  )

  return [
    { label: "package.json", version: await jsonVersion("package.json") },
    { label: "picker/package.json", version: await jsonVersion("picker/package.json") },
    {
      label: "picker/src-tauri/tauri.conf.json",
      version: await jsonVersion("picker/src-tauri/tauri.conf.json"),
    },
    {
      label: "picker/src-tauri/Cargo.toml",
      version: cargoManifestVersion(cargoManifest),
    },
    {
      label: "picker/src-tauri/Cargo.lock",
      version: cargoLockPackageVersion(cargoLock, "opencode-model-dispatch-picker"),
    },
    { label: "assets/manifest.json", version: await jsonVersion("assets/manifest.json") },
    {
      label: "picker/public/assets/manifest.json",
      version: await jsonVersion("picker/public/assets/manifest.json"),
    },
  ]
}

async function main(): Promise<void> {
  const entries = await releaseVersionEntries()
  const releaseTag = process.env.RELEASE_TAG
  const failures = releaseVersionFailures(entries, releaseTag)

  if (failures.length > 0) {
    for (const failure of failures) console.error(`release version check failed: ${failure}`)
    process.exit(1)
  }

  const tagMessage = releaseTag ? ` and tag ${releaseTag}` : ""
  console.log(`release version check passed: ${entries[0]!.version} across ${entries.length} manifests${tagMessage}`)
}

if (import.meta.main) {
  await main()
}
