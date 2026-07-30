import { spawnSync } from "node:child_process"
import { readFile } from "node:fs/promises"

export type OpenCodeCompatibilityRole =
  | "minimum"
  | "minor-latest"
  | "minimum-and-minor-latest"

export interface OpenCodeCompatibilityTarget {
  line: string
  role: OpenCodeCompatibilityRole
  version: string
}

export const OPENCODE_MINOR_HISTORY = 5

interface StableVersion {
  major: number
  minor: number
  patch: number
  raw: string
}

interface SupportedRange {
  minimum: StableVersion
  upperMajor: number
}

export function resolveOpenCodeCompatibilityTargets(
  engineRange: unknown,
  registryVersions: unknown,
): OpenCodeCompatibilityTarget[] {
  const supported = parseSupportedRange(engineRange)
  if (!Array.isArray(registryVersions)) {
    throw new Error("npm registry versions must be an array")
  }

  const stableVersions = new Map<string, StableVersion>()
  for (const value of registryVersions) {
    if (typeof value !== "string") {
      throw new Error("npm registry versions must contain only strings")
    }
    const version = parseStableVersion(value)
    if (version) stableVersions.set(version.raw, version)
  }

  if (!stableVersions.has(supported.minimum.raw)) {
    throw new Error(
      `declared minimum OpenCode ${supported.minimum.raw} is not published`,
    )
  }

  const eligible = [...stableVersions.values()]
    .filter(
      (version) =>
        compareVersions(version, supported.minimum) >= 0 &&
        version.major < supported.upperMajor,
    )
    .sort(compareVersions)

  if (eligible.length === 0) {
    throw new Error(`no stable OpenCode versions satisfy ${engineRange}`)
  }

  const latestByMinor = new Map<string, StableVersion>()
  for (const version of eligible) {
    latestByMinor.set(minorLine(version), version)
  }

  const activeMinorVersions = [...latestByMinor.values()]
    .sort(compareVersions)
    .slice(-(OPENCODE_MINOR_HISTORY + 1))
  const targets: OpenCodeCompatibilityTarget[] = []

  for (const latest of activeMinorVersions) {
    const line = minorLine(latest)
    const containsMinimum =
      latest.major === supported.minimum.major &&
      latest.minor === supported.minimum.minor

    if (containsMinimum && latest.raw !== supported.minimum.raw) {
      targets.push({
        line,
        role: "minimum",
        version: supported.minimum.raw,
      })
    }

    targets.push({
      line,
      role: containsMinimum && latest.raw === supported.minimum.raw
        ? "minimum-and-minor-latest"
        : "minor-latest",
      version: latest.raw,
    })
  }

  return targets
}

function parseSupportedRange(value: unknown): SupportedRange {
  if (typeof value !== "string") {
    throw new Error("package.json engines.opencode must be a string")
  }

  const match = /^>=(\d+\.\d+\.\d+) <(\d+)$/.exec(value)
  if (!match) {
    throw new Error(
      "package.json engines.opencode must use the explicit form >=x.y.z <N",
    )
  }

  const minimum = parseStableVersion(match[1])
  const upperMajor = parseSafeInteger(match[2])
  if (!minimum || upperMajor === undefined || minimum.major >= upperMajor) {
    throw new Error(`invalid OpenCode engine range: ${value}`)
  }

  return { minimum, upperMajor }
}

function parseStableVersion(value: string): StableVersion | undefined {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value)
  if (!match) return undefined

  const major = parseSafeInteger(match[1])
  const minor = parseSafeInteger(match[2])
  const patch = parseSafeInteger(match[3])
  if (major === undefined || minor === undefined || patch === undefined) {
    return undefined
  }

  return { major, minor, patch, raw: value }
}

function parseSafeInteger(value: string): number | undefined {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : undefined
}

function compareVersions(left: StableVersion, right: StableVersion): number {
  return (
    left.major - right.major ||
    left.minor - right.minor ||
    left.patch - right.patch
  )
}

function minorLine(version: StableVersion): string {
  return `${version.major}.${version.minor}.x`
}

async function main(): Promise<void> {
  const packageManifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as unknown
  if (!isRecord(packageManifest) || !isRecord(packageManifest.engines)) {
    throw new Error("package.json must contain an engines object")
  }

  const result = spawnSync(
    "npm",
    ["view", "opencode-ai", "versions", "--json"],
    {
      cwd: new URL("../", import.meta.url),
      encoding: "utf8",
      timeout: 60_000,
    },
  )
  if (result.status !== 0) {
    throw new Error(
      result.stderr.trim() ||
        `npm view opencode-ai versions exited with ${result.status ?? "no status"}`,
    )
  }

  let registryVersions: unknown
  try {
    registryVersions = JSON.parse(result.stdout)
  } catch {
    throw new Error("npm returned invalid JSON for opencode-ai versions")
  }

  const targets = resolveOpenCodeCompatibilityTargets(
    packageManifest.engines.opencode,
    registryVersions,
  )
  process.stdout.write(`${JSON.stringify(targets)}\n`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

if (import.meta.main) {
  try {
    await main()
  } catch (error) {
    console.error(
      `OpenCode compatibility resolution failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    process.exit(1)
  }
}
