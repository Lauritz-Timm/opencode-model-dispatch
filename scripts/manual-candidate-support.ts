import { createHash, randomBytes } from "node:crypto"
import {
  chmod,
  copyFile,
  cp,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
} from "node:fs/promises"
import {
  basename,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path"

import type { PickerTarget } from "../src/picker-targets"

export const defaultManualCandidateOutput = ".manual-release"
export const manualCandidateMetadataFilename = "manual-candidate.json"

const fullCommitPattern = /^[0-9a-f]{40}$/i
const npmIntegrityPattern = /^sha512-[A-Za-z0-9+/]{86}==$/
const sha256Pattern = /^[0-9a-f]{64}$/i
const manualCandidateNoncePattern = /^[0-9a-f]{16}$/

export interface ManualCandidateMetadata {
  schemaVersion: 1
  commitSha: string
  packageName: string
  packageVersion: string
  tarball: string
  tarballIntegrity: string
  pickerPath: string
  pickerSha256: string
}

export type ManualCandidateCommand =
  | { action: "prepare"; output: string }
  | { action: "install"; output: string; project: string; openCode: string }
  | { action: "test"; output: string; tui: boolean }
  | { action: "help" }

export interface VerifiedManualCandidate {
  metadata: ManualCandidateMetadata
  tarballPath: string
  pickerPath: string
}

export function parseManualCandidateArguments(
  arguments_: readonly string[],
): ManualCandidateCommand {
  const args = arguments_.filter((argument) => argument !== "--")
  if (args.includes("--help") || args.includes("-h")) return { action: "help" }

  const action = args.shift()
  if (action !== "prepare" && action !== "install" && action !== "test") {
    throw new Error("Expected prepare, install, or test")
  }

  let output = defaultManualCandidateOutput
  let project: string | undefined
  let openCode = process.env.OPENCODE_BIN?.trim() || "opencode"
  let tui = false
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === "--output") {
      output = requiredOptionValue(args, ++index, "--output")
      continue
    }
    if (argument === "--project") {
      project = requiredOptionValue(args, ++index, "--project")
      continue
    }
    if (argument === "--opencode") {
      openCode = requiredOptionValue(args, ++index, "--opencode")
      continue
    }
    if (argument === "--tui") {
      tui = true
      continue
    }
    throw new Error(`Unknown manual candidate argument: ${argument}`)
  }

  if (action === "prepare") return { action, output }
  if (action === "install") {
    if (!project) throw new Error("install requires --project <empty-directory>")
    return { action, output, project, openCode }
  }
  return { action, output, tui }
}

export function resolveManualCandidateOutput(
  repositoryRoot: string,
  output: string,
): { absolutePath: string; repositoryPath: string } {
  if (!output || output.trim() !== output || isAbsolute(output)) {
    throw new Error(
      "Manual candidate output must be a nonempty repository-relative directory",
    )
  }
  const absolutePath = resolve(repositoryRoot, output)
  const repositoryPath = relative(repositoryRoot, absolutePath)
  if (
    !repositoryPath ||
    repositoryPath === ".." ||
    repositoryPath.startsWith(`..${sep}`) ||
    isAbsolute(repositoryPath)
  ) {
    throw new Error("Manual candidate output must stay inside the repository")
  }
  return {
    absolutePath,
    repositoryPath: repositoryPath.split(sep).join("/"),
  }
}

export function manualCandidateGitIgnorePath(
  repositoryPath: string,
): string {
  return `${repositoryPath.replace(/\/+$/, "")}/`
}

export function manualCandidateInstallSpec(
  metadata: Pick<
    ManualCandidateMetadata,
    "commitSha" | "packageName" | "packageVersion"
  >,
  nonce = randomBytes(8).toString("hex"),
): string {
  assertManualCandidateCommit(metadata.commitSha)
  assertManualCandidateNonce(nonce)
  return [
    "opencode-model-dispatch-manual",
    metadata.commitSha.slice(0, 12).toLowerCase(),
    `${nonce}@npm:${metadata.packageName}@${metadata.packageVersion}`,
  ].join("-")
}

export function manualCandidateTarballFilename(
  packedFilename: string,
  commitSha: string,
  nonce = randomBytes(8).toString("hex"),
): string {
  assertSafeTarballFilename(
    packedFilename,
    "Packed manual candidate tarball",
  )
  assertManualCandidateCommit(commitSha)
  assertManualCandidateNonce(nonce)
  return [
    packedFilename.slice(0, -4),
    commitSha.slice(0, 12).toLowerCase(),
    `${nonce}.tgz`,
  ].join("-")
}

export async function invalidateManualCandidate(
  outputRoot: string,
): Promise<void> {
  const metadataPath = join(outputRoot, manualCandidateMetadataFilename)
  let metadata: Awaited<ReturnType<typeof lstat>>
  try {
    metadata = await lstat(metadataPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return
    throw error
  }
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(
      "Existing manual candidate metadata must be a real regular file",
    )
  }
  await rm(metadataPath)
}

export async function promoteManualCandidate(options: {
  outputRoot: string
  stagedTarball: string
  stagedMetadata: string
  tarballFilename: string
}): Promise<{ tarballPath: string; metadataPath: string }> {
  assertSafeTarballFilename(
    options.tarballFilename,
    "Retained manual candidate tarball",
  )
  const tarballPath = join(options.outputRoot, options.tarballFilename)
  const metadataPath = join(
    options.outputRoot,
    manualCandidateMetadataFilename,
  )
  await Promise.all([
    assertRegularFile(options.stagedTarball, "staged manual candidate tarball"),
    assertRegularFile(options.stagedMetadata, "staged manual candidate metadata"),
    assertMissingPath(tarballPath, "retained manual candidate tarball"),
    assertMissingPath(metadataPath, "retained manual candidate metadata"),
  ])

  await rename(options.stagedTarball, tarballPath)
  try {
    await rename(options.stagedMetadata, metadataPath)
  } catch (error) {
    await rm(tarballPath, { force: true })
    throw error
  }
  return { tarballPath, metadataPath }
}

export async function discardManualCandidatePromotion(
  outputRoot: string,
  tarballFilename: string,
): Promise<void> {
  assertSafeTarballFilename(
    tarballFilename,
    "Retained manual candidate tarball",
  )
  await Promise.all([
    removeCandidateLeaf(
      join(outputRoot, manualCandidateMetadataFilename),
      "manual candidate metadata",
    ),
    removeCandidateLeaf(
      join(outputRoot, tarballFilename),
      "manual candidate tarball",
    ),
  ])
}

export function readManualCandidateMetadata(
  value: unknown,
): ManualCandidateMetadata {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new Error("Manual candidate metadata must use schemaVersion 1")
  }

  const metadata: ManualCandidateMetadata = {
    schemaVersion: 1,
    commitSha: readRequiredString(value, "commitSha"),
    packageName: readRequiredString(value, "packageName"),
    packageVersion: readRequiredString(value, "packageVersion"),
    tarball: readRequiredString(value, "tarball"),
    tarballIntegrity: readRequiredString(value, "tarballIntegrity"),
    pickerPath: readRequiredString(value, "pickerPath"),
    pickerSha256: readRequiredString(value, "pickerSha256"),
  }
  if (!fullCommitPattern.test(metadata.commitSha)) {
    throw new Error("Manual candidate commitSha must be a full commit SHA")
  }
  if (
    basename(metadata.tarball) !== metadata.tarball ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*\.tgz$/.test(metadata.tarball)
  ) {
    throw new Error("Manual candidate tarball must be a safe .tgz basename")
  }
  if (!npmIntegrityPattern.test(metadata.tarballIntegrity)) {
    throw new Error("Manual candidate tarballIntegrity must be canonical SHA-512 SRI")
  }
  if (
    !/^dist-picker\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(
      metadata.pickerPath,
    )
  ) {
    throw new Error(
      "Manual candidate pickerPath must be a dist-picker repository path",
    )
  }
  if (!sha256Pattern.test(metadata.pickerSha256)) {
    throw new Error("Manual candidate pickerSha256 must be 64 hexadecimal characters")
  }
  return metadata
}

export async function stageManualCandidatePackage(options: {
  repositoryRoot: string
  stageRoot: string
  picker: PickerTarget
}): Promise<void> {
  const { repositoryRoot, stageRoot, picker } = options
  await mkdir(join(stageRoot, "bin"), { recursive: true })
  for (const path of [
    "package.json",
    "README.md",
    "LICENSE",
    "THIRD_PARTY_NOTICES.md",
  ]) {
    await copyFile(join(repositoryRoot, path), join(stageRoot, path))
  }
  await cp(join(repositoryRoot, "dist"), join(stageRoot, "dist"), {
    recursive: true,
    force: false,
    errorOnExist: true,
  })
  await copyFile(
    join(repositoryRoot, "bin", "picker.js"),
    join(stageRoot, "bin", "picker.js"),
  )
  await copyFile(
    join(repositoryRoot, "dist-picker", picker.assetName),
    join(stageRoot, "bin", picker.assetName),
  )
  await chmod(join(stageRoot, "bin", "picker.js"), 0o755)
  if (picker.executable) {
    await chmod(join(stageRoot, "bin", picker.assetName), 0o755)
  }
}

export async function verifyManualCandidate(options: {
  repositoryRoot: string
  outputRoot: string
  expectedCommit: string
  picker: PickerTarget
  packageName: string
  packageVersion: string
}): Promise<VerifiedManualCandidate> {
  const metadataPath = join(
    options.outputRoot,
    manualCandidateMetadataFilename,
  )
  await assertRegularFile(metadataPath, "manual candidate metadata")
  const metadata = readManualCandidateMetadata(
    JSON.parse(await readFile(metadataPath, "utf8")) as unknown,
  )
  if (metadata.commitSha.toLowerCase() !== options.expectedCommit.toLowerCase()) {
    throw new Error(
      `Manual candidate was built from ${metadata.commitSha}, not current HEAD ${options.expectedCommit}`,
    )
  }
  if (
    metadata.packageName !== options.packageName ||
    metadata.packageVersion !== options.packageVersion
  ) {
    throw new Error("Manual candidate package identity no longer matches package.json")
  }

  const expectedPickerPath = `dist-picker/${options.picker.assetName}`
  if (metadata.pickerPath !== expectedPickerPath) {
    throw new Error(
      `Manual candidate pickerPath must be ${expectedPickerPath} on this host`,
    )
  }

  const tarballPath = join(options.outputRoot, metadata.tarball)
  const pickerPath = join(options.repositoryRoot, ...metadata.pickerPath.split("/"))
  await assertRegularFile(tarballPath, "manual candidate tarball")
  await assertRegularFile(pickerPath, "manual candidate picker")

  const [tarballIntegrity, pickerSha256] = await Promise.all([
    sha512Integrity(tarballPath),
    sha256(pickerPath),
  ])
  if (tarballIntegrity !== metadata.tarballIntegrity) {
    throw new Error("Retained manual candidate tarball no longer matches its SHA-512")
  }
  if (pickerSha256 !== metadata.pickerSha256) {
    throw new Error("Manual candidate picker no longer matches its SHA-256")
  }
  return { metadata, tarballPath, pickerPath }
}

export async function assertRegularFile(
  path: string,
  label: string,
): Promise<void> {
  const metadata = await lstat(path)
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`${label} must be a real regular file`)
  }
}

export async function sha512Integrity(path: string): Promise<string> {
  const bytes = await readFile(path)
  return `sha512-${createHash("sha512").update(bytes).digest("base64")}`
}

export async function sha256(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex")
}

async function assertMissingPath(path: string, label: string): Promise<void> {
  try {
    await lstat(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return
    throw error
  }
  throw new Error(`${label} already exists and will not be overwritten`)
}

async function removeCandidateLeaf(
  path: string,
  label: string,
): Promise<void> {
  let metadata: Awaited<ReturnType<typeof lstat>>
  try {
    metadata = await lstat(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return
    throw error
  }
  if (metadata.isDirectory() && !metadata.isSymbolicLink()) {
    throw new Error(`${label} cleanup path must not be a directory`)
  }
  await rm(path)
}

function assertManualCandidateCommit(commitSha: string): void {
  if (!fullCommitPattern.test(commitSha)) {
    throw new Error("Manual candidate commitSha must be a full commit SHA")
  }
}

function assertManualCandidateNonce(nonce: string): void {
  if (!manualCandidateNoncePattern.test(nonce)) {
    throw new Error(
      "Manual candidate nonce must be exactly 16 lowercase hexadecimal characters",
    )
  }
}

function assertSafeTarballFilename(filename: string, label: string): void {
  if (
    basename(filename) !== filename
    || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.tgz$/.test(filename)
  ) {
    throw new Error(`${label} must be a safe .tgz basename`)
  }
}

function requiredOptionValue(
  args: readonly string[],
  index: number,
  option: string,
): string {
  const value = args[index]
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value`)
  }
  return value
}

function readRequiredString(
  value: Record<string, unknown>,
  key: string,
): string {
  const candidate = value[key]
  if (
    typeof candidate !== "string" ||
    candidate.length === 0 ||
    candidate.trim() !== candidate
  ) {
    throw new Error(`Manual candidate metadata ${key} must be a nonempty string`)
  }
  return candidate
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
