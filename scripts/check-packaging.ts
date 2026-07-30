import { Buffer } from "node:buffer"
import { mkdtemp, open, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import {
  PICKER_TARGETS,
  pickerTargetForAsset,
  type PickerBinaryFormat,
} from "../src/picker-targets"

type PackageJson = {
  files?: string[]
  bin?: Record<string, string>
  scripts?: Record<string, string>
  engines?: Record<string, string>
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
  homepage?: string
  repository?: { url?: string }
  bugs?: { url?: string }
  packageManager?: string
  publishConfig?: { access?: string; provenance?: boolean }
}

export interface ReleasePickerAsset {
  name: string
  format: string
  magic: number[][]
  executable: boolean
}

type NpmPackFile = {
  path?: unknown
  mode?: unknown
}

type NpmPackResult = {
  files?: unknown
}

const releaseAssetPattern = "picker-${platform}-${arch}${ext}"
const releaseAssetUrl =
  "https://github.com/Lauritz-Timm/opencode-model-dispatch/releases/download/v${version}/picker-${platform}-${arch}${ext}"
const pickerOverrideEnv = "OPENCODE_MODEL_DISPATCH_PICKER"
const repositoryUrl = "git+https://github.com/Lauritz-Timm/opencode-model-dispatch.git"
const root = new URL("../", import.meta.url)
const defaultPickerAssetRoot = new URL("../bin/", import.meta.url)
const minimumExecutableBytes = 64

export const releasePickerAssets: ReleasePickerAsset[] =
  PICKER_TARGETS.map((target) => ({
    name: target.assetName,
    format: formatLabel(target.format),
    magic: formatMagic(target.format),
    executable: target.executable,
  }))

const releasePackageBinFiles = [
  { path: "bin/picker.js", executable: true },
  ...releasePickerAssets.map((asset) => ({
    path: `bin/${asset.name}`,
    executable: asset.executable,
  })),
]

export async function releasePickerAssetFailures(
  assetRoot = defaultPickerAssetRoot,
): Promise<string[]> {
  const failures: string[] = []

  for (const asset of releasePickerAssets) {
    const assetUrl = new URL(asset.name, assetRoot)
    let metadata: Awaited<ReturnType<typeof stat>>
    try {
      metadata = await stat(assetUrl)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        failures.push(`published package must contain bin/${asset.name}`)
        continue
      }
      throw error
    }

    if (!metadata.isFile()) {
      failures.push(`bin/${asset.name} must be a regular file`)
      continue
    }
    if (metadata.size < minimumExecutableBytes) {
      failures.push(
        `bin/${asset.name} must be a nonempty native executable of at least ${minimumExecutableBytes} bytes`,
      )
      continue
    }
    if (asset.executable && (metadata.mode & 0o111) === 0) {
      failures.push(`bin/${asset.name} must have a Unix executable mode`)
    }

    const handle = await open(assetUrl, "r")
    try {
      const header = Buffer.alloc(4096)
      const { bytesRead } = await handle.read(header, 0, header.length, 0)
      const architectureFailure = validateNativeArchitecture(asset.name, header.subarray(0, bytesRead))
      if (architectureFailure) {
        failures.push(
          `bin/${asset.name} ${architectureFailure}; received ${header.subarray(0, Math.min(bytesRead, 16)).toString("hex")}`,
        )
      }
    } finally {
      await handle.close()
    }
  }

  return failures
}

export function releasePackageFileFailures(value: unknown): string[] {
  const entries = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.values(value)
      : []
  if (entries.length !== 1) {
    return [
      `npm pack --dry-run must return exactly one package; received ${entries.length}`,
    ]
  }

  const files = (entries[0] as NpmPackResult | undefined)?.files
  if (!Array.isArray(files)) {
    return ["npm pack --dry-run result must contain a files array"]
  }
  const failures: string[] = []
  const filesByPath = new Map<string, NpmPackFile>()
  for (const value of files) {
    const file = value as NpmPackFile | undefined
    if (typeof file?.path !== "string") continue
    if (filesByPath.has(file.path)) {
      failures.push(`staged npm package must contain ${file.path} exactly once`)
      continue
    }
    filesByPath.set(file.path, file)
  }

  const expectedBinPaths = new Set(
    releasePackageBinFiles.map((file) => file.path),
  )
  for (const expected of releasePackageBinFiles) {
    const file = filesByPath.get(expected.path)
    if (!file) {
      failures.push(`staged npm package must contain ${expected.path}`)
      continue
    }
    if (
      expected.executable &&
      (typeof file.mode !== "number" ||
        !Number.isInteger(file.mode) ||
        (file.mode & 0o777) !== 0o755)
    ) {
      failures.push(
        `staged npm package ${expected.path} must have tar mode 0755; received ${formatMode(file.mode)}`,
      )
    }
  }

  for (const path of filesByPath.keys()) {
    if (path.startsWith("bin/") && !expectedBinPaths.has(path)) {
      failures.push(`staged npm package must not contain unexpected ${path}`)
    }
  }
  return failures
}

function formatMode(value: unknown): string {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? `0${(value & 0o777).toString(8)}`
    : value === undefined
      ? "missing"
      : JSON.stringify(value)
}

async function stagedReleasePackageFailures(): Promise<string[]> {
  const work = await mkdtemp(join(tmpdir(), "model-dispatch-pack-check-"))
  try {
    const stdoutPath = join(work, "npm-pack.json")
    const stderrPath = join(work, "npm-pack.stderr")
    const child = Bun.spawn(
      ["npm", "pack", "--json", "--dry-run", "--ignore-scripts"],
      {
        cwd: fileURLToPath(root),
        env: {
          ...process.env,
          npm_config_cache: join(work, "npm-cache"),
        },
        stdout: Bun.file(stdoutPath),
        stderr: Bun.file(stderrPath),
      },
    )
    const exitCode = await child.exited
    const stdout = await Bun.file(stdoutPath).text()
    const stderr = await Bun.file(stderrPath).text()
    if (exitCode !== 0) {
      return [
        `npm pack --dry-run failed: ${stderr.trim() || `exit ${exitCode}`}`,
      ]
    }
    try {
      return releasePackageFileFailures(JSON.parse(stdout) as unknown)
    } catch (error) {
      return [
        `npm pack --dry-run returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      ]
    }
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

function validateNativeArchitecture(name: string, header: Buffer): string | undefined {
  const target = pickerTargetForAsset(name)
  if (!target) return "is not a declared release target"

  if (target.format === "elf") {
    if (
      header.length < 20 ||
      header.subarray(0, 4).toString("hex") !== "7f454c46" ||
      header[4] !== 2 ||
      header[5] !== 1
    ) return "must have 64-bit little-endian ELF binary magic"
    if (header.readUInt16LE(18) !== target.machine) {
      return `must target the ${target.arch} ELF architecture`
    }
    return undefined
  }

  if (target.format === "mach-o") {
    if (header.length < 8 || header.subarray(0, 4).toString("hex") !== "cffaedfe") {
      return "must have 64-bit little-endian Mach-O binary magic"
    }
    if (header.readUInt32LE(4) !== target.machine) {
      return `must target the ${target.arch} Mach-O architecture`
    }
    return undefined
  }

  if (header.length < 64 || header.subarray(0, 2).toString("hex") !== "4d5a") {
    return "must have PE binary magic"
  }
  const peOffset = header.readUInt32LE(0x3c)
  if (peOffset + 6 > header.length || header.subarray(peOffset, peOffset + 4).toString("hex") !== "50450000") {
    return "must have a valid PE header"
  }
  if (header.readUInt16LE(peOffset + 4) !== target.machine) {
    return `must target the ${target.arch} PE architecture`
  }
  return undefined
}

function formatLabel(format: PickerBinaryFormat): string {
  if (format === "elf") return "ELF"
  if (format === "mach-o") return "Mach-O"
  return "PE"
}

function formatMagic(format: PickerBinaryFormat): number[][] {
  if (format === "elf") return [[0x7f, 0x45, 0x4c, 0x46]]
  if (format === "mach-o") return [[0xcf, 0xfa, 0xed, 0xfe]]
  return [[0x4d, 0x5a]]
}

function expectIncludes(
  failures: string[],
  haystack: string | string[] | undefined,
  needle: string,
  label: string,
): void {
  if (!haystack?.includes(needle)) failures.push(`${label} must include ${needle}`)
}

function expectMissing(
  failures: string[],
  haystack: string | undefined,
  needle: string,
  label: string,
): void {
  if (haystack?.includes(needle)) failures.push(`${label} must not include ${needle}`)
}

async function readText(path: string): Promise<string> {
  return await readFile(new URL(path, root), "utf8")
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readText(path)) as T
}

async function main(): Promise<void> {
  const failures: string[] = []
  const pkg = await readJson<PackageJson>("package.json")
  const readme = await readText("README.md")
  const requireAllPickers =
    process.argv.includes("--require-all-pickers") ||
    process.env.REQUIRE_ALL_PICKERS === "1"

  expectIncludes(failures, pkg.files, "dist", "package files")
  expectIncludes(failures, pkg.files, "assets", "package files")
  expectIncludes(failures, pkg.files, "bin", "package files")
  expectIncludes(
    failures,
    pkg.files,
    "THIRD_PARTY_NOTICES.md",
    "package files",
  )
  if (pkg.files?.includes("docs/manual-integration-gate.md")) {
    failures.push("package files must not include the release-operator manual gate")
  }
  if (pkg.packageManager !== "bun@1.3.14") {
    failures.push("packageManager must pin bun@1.3.14")
  }
  if (pkg.engines?.node !== ">=18") {
    failures.push(
      "package engines.node must require >=18 for fetch, Web Streams, and Readable.toWeb",
    )
  }
  if (pkg.engines?.opencode !== ">=1.18.7 <2") {
    failures.push("package engines.opencode must require >=1.18.7 <2")
  }
  if (pkg.peerDependencies?.["@opencode-ai/plugin"] !== ">=1.18.7 <2") {
    failures.push(
      "package must require the compatible @opencode-ai/plugin peer used by its public declarations",
    )
  }
  if (pkg.peerDependenciesMeta?.["@opencode-ai/plugin"] !== undefined) {
    failures.push(
      "@opencode-ai/plugin must not be an optional peer because public declarations import it",
    )
  }
  if (pkg.publishConfig?.access !== "public" || pkg.publishConfig.provenance !== true) {
    failures.push("publishConfig must require public access and provenance")
  }
  if (pkg.files?.includes("scripts")) {
    failures.push("package files must not include development scripts")
  }
  if (pkg.files?.includes("picker/src-tauri")) {
    failures.push("package files must not include picker/src-tauri")
  }
  if (pkg.bin?.["opencode-model-dispatch-picker"] !== "./bin/picker.js") {
    failures.push(
      "package bin must expose opencode-model-dispatch-picker at ./bin/picker.js",
    )
  }
  if (pkg.homepage !== "https://github.com/Lauritz-Timm/opencode-model-dispatch#readme") {
    failures.push("package homepage must point to the canonical GitHub repository")
  }
  if (pkg.repository?.url !== repositoryUrl) {
    failures.push(
      `package repository.url must equal ${repositoryUrl} for npm provenance`,
    )
  }
  if (
    pkg.bugs?.url !==
    "https://github.com/Lauritz-Timm/opencode-model-dispatch/issues"
  ) {
    failures.push("package bugs.url must point to the canonical GitHub repository")
  }
  if (requireAllPickers) {
    failures.push(...(await releasePickerAssetFailures()))
    failures.push(...(await stagedReleasePackageFailures()))
  }

  for (const lifecycle of ["install", "postinstall", "prepare"]) {
    if (pkg.scripts?.[lifecycle]) {
      failures.push(
        `package must not define ${lifecycle}; npm install must not build native code`,
      )
    }
  }

  expectIncludes(
    failures,
    pkg.scripts?.prepublishOnly,
    "check:release-package",
    "prepublishOnly",
  )
  expectMissing(failures, pkg.scripts?.prepublishOnly, "tauri", "prepublishOnly")
  expectMissing(
    failures,
    JSON.stringify(pkg.dependencies ?? {}),
    "tauri",
    "dependencies",
  )
  expectMissing(
    failures,
    JSON.stringify(pkg.optionalDependencies ?? {}),
    "tauri",
    "optionalDependencies",
  )

  for (const text of [
    releaseAssetPattern,
    releaseAssetUrl,
    pickerOverrideEnv,
    "No Rust or Tauri toolchain is required",
  ]) {
    expectIncludes(failures, readme, text, "README")
  }

  for (const heading of [
    "## Install",
    "## Configuration",
    "## Setup",
    "## Privacy",
    "## Troubleshooting",
  ]) {
    expectIncludes(failures, readme, heading, "README")
  }

  if (failures.length > 0) {
    for (const message of failures) {
      console.error(`packaging check failed: ${message}`)
    }
    process.exit(1)
  }

  const pickerMessage = requireAllPickers
    ? ` and ${releasePickerAssets.length} native picker binaries`
    : ""
  console.log(
    `packaging check passed: documented release asset path ${releaseAssetPattern}${pickerMessage}`,
  )
}

if (import.meta.main) {
  await main()
}
