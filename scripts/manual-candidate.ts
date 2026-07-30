import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import {
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path"
import { fileURLToPath } from "node:url"

import {
  pickerTargetForNode,
  type PickerTarget,
} from "../src/picker-targets"
import {
  assertRegularFile,
  defaultManualCandidateOutput,
  manualCandidateGitIgnorePath,
  manualCandidateMetadataFilename,
  parseManualCandidateArguments,
  resolveManualCandidateOutput,
  sha256,
  sha512Integrity,
  stageManualCandidatePackage,
  verifyManualCandidate,
  type ManualCandidateMetadata,
  type VerifiedManualCandidate,
} from "./manual-candidate-support"

export {
  parseManualCandidateArguments,
  readManualCandidateMetadata,
  resolveManualCandidateOutput,
  stageManualCandidatePackage,
  verifyManualCandidate,
  type ManualCandidateCommand,
  type ManualCandidateMetadata,
  type VerifiedManualCandidate,
} from "./manual-candidate-support"

const root = fileURLToPath(new URL("../", import.meta.url))

if (import.meta.main) {
  try {
    await main()
  } catch (error) {
    console.error(
      `manual candidate failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    process.exit(1)
  }
}

async function main(): Promise<void> {
  const command = parseManualCandidateArguments(process.argv.slice(2))
  if (command.action === "help") {
    printHelp()
    return
  }

  if (command.action === "prepare") {
    await prepareManualCandidate(command.output)
    return
  }
  if (command.action === "install") {
    await installManualCandidate(
      command.output,
      command.project,
      command.openCode,
    )
    return
  }
  await testManualCandidate(command.output, command.tui)
}

async function prepareManualCandidate(output: string): Promise<void> {
  await runInherited([process.execPath, "run", "check:release-source"], root)
  const commitSha = await gitOutput(["rev-parse", "--verify", "HEAD^{commit}"])
  const target = requiredHostPicker()
  const outputPaths = resolveManualCandidateOutput(root, output)
  await assertIgnoredOutput(outputPaths.repositoryPath)

  await runInherited([process.execPath, "run", "build"], root)
  await runInherited([process.execPath, "run", "build:picker"], root)
  await runInherited(
    [process.execPath, "run", "check:picker-host"],
    root,
    {
      ...process.env,
      MODEL_DISPATCH_EXPECTED_PICKER_PLATFORM: target.platform,
      MODEL_DISPATCH_EXPECTED_PICKER_ARCH: target.arch,
    },
  )
  await ensureContainedDirectory(root, outputPaths.absolutePath)

  const packageManifest = await readSourcePackageManifest()
  const pickerPath = `dist-picker/${target.assetName}`
  await assertRegularFile(
    join(root, ...pickerPath.split("/")),
    "freshly built picker",
  )

  const work = await mkdtemp(
    join(outputPaths.absolutePath, ".manual-candidate-work-"),
  )
  try {
    const stageRoot = join(work, "package")
    const packRoot = join(work, "pack")
    await Promise.all([
      mkdir(stageRoot, { recursive: true }),
      mkdir(packRoot, { recursive: true }),
    ])
    await stageManualCandidatePackage({
      repositoryRoot: root,
      stageRoot,
      picker: target,
    })

    await runInherited(
      [
        "npm",
        "pack",
        "--silent",
        "--ignore-scripts",
        "--pack-destination",
        packRoot,
        stageRoot,
      ],
      root,
      {
        ...process.env,
        npm_config_cache: join(work, "npm-cache"),
      },
    )
    const packedEntries = await readdir(packRoot)
    if (
      packedEntries.length !== 1 ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]*\.tgz$/.test(packedEntries[0]!)
    ) {
      throw new Error(
        `npm pack must create exactly one safe .tgz file; received ${packedEntries.join(", ") || "none"}`,
      )
    }
    const tarballFilename = packedEntries[0]!
    const packedTarball = join(packRoot, tarballFilename)
    await assertPackedLocalPicker(packedTarball, target)
    const sourceIntegrity = await sha512Integrity(packedTarball)
    const retainedTarball = join(outputPaths.absolutePath, tarballFilename)
    await copyFile(packedTarball, retainedTarball)
    const retainedIntegrity = await sha512Integrity(retainedTarball)
    if (sourceIntegrity !== retainedIntegrity) {
      throw new Error("Retained manual candidate tarball differs from npm pack output")
    }

    const metadata: ManualCandidateMetadata = {
      schemaVersion: 1,
      commitSha,
      packageName: packageManifest.name,
      packageVersion: packageManifest.version,
      tarball: tarballFilename,
      tarballIntegrity: retainedIntegrity,
      pickerPath,
      pickerSha256: await sha256(join(root, ...pickerPath.split("/"))),
    }
    await writeFile(
      join(outputPaths.absolutePath, manualCandidateMetadataFilename),
      `${JSON.stringify(metadata, null, 2)}\n`,
      "utf8",
    )
    await verifyManualCandidate({
      repositoryRoot: root,
      outputRoot: outputPaths.absolutePath,
      expectedCommit: commitSha,
      picker: target,
      packageName: packageManifest.name,
      packageVersion: packageManifest.version,
    })
    await runInherited([process.execPath, "run", "check:release-source"], root)
    const finalCommitSha = await gitOutput([
      "rev-parse",
      "--verify",
      "HEAD^{commit}",
    ])
    if (finalCommitSha.toLowerCase() !== commitSha.toLowerCase()) {
      throw new Error(
        `Release source changed from ${commitSha} to ${finalCommitSha} while preparing the manual candidate`,
      )
    }
    printEvidence(metadata, outputPaths.repositoryPath)
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

async function installManualCandidate(
  output: string,
  projectInput: string,
  openCode: string,
): Promise<void> {
  await runInherited([process.execPath, "run", "check:release-source"], root)
  const outputPaths = resolveManualCandidateOutput(root, output)
  await assertIgnoredOutput(outputPaths.repositoryPath)
  const candidate = await verifyCurrentManualCandidate(outputPaths.absolutePath)
  const project = await requireEmptyScratchProject(projectInput)
  const work = await mkdtemp(join(tmpdir(), "model-dispatch-manual-install-"))
  const { startLocalNpmRegistry } = await import("./local-npm-registry")
  const registry = await startLocalNpmRegistry({
    root,
    work,
    initialTarballs: [{
      packageRoot: root,
      tarballPath: candidate.tarballPath,
    }],
  })

  try {
    const environment = {
      ...process.env,
      BUN_CONFIG_REGISTRY: registry.baseURL,
      BUN_INSTALL_CACHE_DIR: join(work, "bun-cache"),
      NPM_CONFIG_REGISTRY: registry.baseURL,
      npm_config_registry: registry.baseURL,
      npm_config_cache: join(work, "npm-cache"),
      NO_PROXY: "127.0.0.1,localhost",
      no_proxy: "127.0.0.1,localhost",
      OPENCODE_DISABLE_AUTOUPDATE: "true",
    }
    const packageSpec =
      `${candidate.metadata.packageName}@${candidate.metadata.packageVersion}`
    await runInherited(
      [openCode, "plugin", packageSpec],
      project,
      environment,
    )
    registry.assertInstalled(candidate.metadata.packageName)
  } finally {
    registry.server.stop(true)
    await rm(work, { recursive: true, force: true })
  }

  console.log(
    "Exact manual candidate installed in the empty scratch project through a loopback-only registry.",
  )
  console.log(
    "Open that same project in OpenCode TUI and OpenCode Desktop; no registry override is needed after installation.",
  )
  printEvidence(candidate.metadata, outputPaths.repositoryPath)
}

async function testManualCandidate(
  output: string,
  tui: boolean,
): Promise<void> {
  await runInherited([process.execPath, "run", "check:release-source"], root)
  const outputPaths = resolveManualCandidateOutput(root, output)
  await assertIgnoredOutput(outputPaths.repositoryPath)
  const candidate = await verifyCurrentManualCandidate(outputPaths.absolutePath)
  await runInherited(
    [
      process.execPath,
      "run",
      "scripts/run-installed-native-opencode.ts",
      ...(tui ? ["--tui"] : []),
    ],
    root,
    {
      ...process.env,
      MODEL_DISPATCH_TEST_PACKAGE_TARBALL: candidate.tarballPath,
    },
  )
}

async function verifyCurrentManualCandidate(
  outputRoot: string,
): Promise<VerifiedManualCandidate> {
  const target = requiredHostPicker()
  const [commitSha, packageManifest] = await Promise.all([
    gitOutput(["rev-parse", "--verify", "HEAD^{commit}"]),
    readSourcePackageManifest(),
  ])
  return verifyManualCandidate({
    repositoryRoot: root,
    outputRoot,
    expectedCommit: commitSha,
    picker: target,
    packageName: packageManifest.name,
    packageVersion: packageManifest.version,
  })
}

async function requireEmptyScratchProject(projectInput: string): Promise<string> {
  if (!projectInput || projectInput.trim() !== projectInput) {
    throw new Error("Scratch project path must be nonempty without surrounding whitespace")
  }
  const project = resolve(projectInput)
  const repositoryRelative = relative(root, project)
  if (
    !repositoryRelative ||
    (
      repositoryRelative !== ".." &&
      !repositoryRelative.startsWith(`..${sep}`) &&
      !isAbsolute(repositoryRelative)
    )
  ) {
    throw new Error("Scratch project must be outside the repository")
  }
  const metadata = await lstat(project)
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error("Scratch project must be a real directory, not a symlink")
  }
  if ((await readdir(project)).length > 0) {
    throw new Error("Scratch project must be empty before installing the candidate")
  }
  return project
}

async function ensureContainedDirectory(
  repositoryRoot: string,
  directory: string,
): Promise<void> {
  const repositoryRealPath = await realpath(repositoryRoot)
  const pathParts = relative(repositoryRoot, directory).split(sep)
  let current = repositoryRoot
  for (const part of pathParts) {
    current = join(current, part)
    try {
      const metadata = await lstat(current)
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
        throw new Error(
          `Manual candidate output component must be a real directory: ${part}`,
        )
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      await mkdir(current)
    }
  }
  const outputRealPath = await realpath(directory)
  const containedPath = relative(repositoryRealPath, outputRealPath)
  if (
    !containedPath ||
    containedPath === ".." ||
    containedPath.startsWith(`..${sep}`) ||
    isAbsolute(containedPath)
  ) {
    throw new Error("Manual candidate output resolved outside the repository")
  }
}

async function assertIgnoredOutput(repositoryPath: string): Promise<void> {
  const result = Bun.spawn(
    [
      "git",
      "check-ignore",
      "--quiet",
      "--no-index",
      "--",
      manualCandidateGitIgnorePath(repositoryPath),
    ],
    {
      cwd: root,
      stdin: "ignore",
      stdout: "ignore",
      stderr: "pipe",
    },
  )
  const [code, stderr] = await Promise.all([
    result.exited,
    new Response(result.stderr).text(),
  ])
  if (code !== 0) {
    throw new Error(
      `Manual candidate output must be ignored by git: ${repositoryPath}`
      + (stderr.trim() ? ` (${stderr.trim()})` : ""),
    )
  }
}

async function assertPackedLocalPicker(
  tarballPath: string,
  target: PickerTarget,
): Promise<void> {
  const archive = await new Bun.Archive(await readFile(tarballPath)).files()
  const paths = [...archive.keys()]
  const expectedPicker = `package/bin/${target.assetName}`
  if (!paths.includes(expectedPicker)) {
    throw new Error(`Manual candidate tarball omitted ${expectedPicker}`)
  }
  const unexpectedPicker = paths.find((path) =>
    /^package\/bin\/picker-(?:linux|macos|windows)-/.test(path) &&
    path !== expectedPicker
  )
  if (unexpectedPicker) {
    throw new Error(
      `Manual candidate tarball contained stale host asset ${unexpectedPicker}`,
    )
  }
}

async function readSourcePackageManifest(): Promise<{
  name: string
  version: string
}> {
  const value = parseJson(
    await readFile(join(root, "package.json"), "utf8"),
    "package.json",
  )
  if (!isRecord(value)) throw new Error("package.json must be an object")
  return {
    name: readRequiredString(value, "name"),
    version: readRequiredString(value, "version"),
  }
}

function requiredHostPicker(): PickerTarget {
  const target = pickerTargetForNode(process.platform, process.arch)
  if (!target) {
    throw new Error(
      `Current host ${process.platform}-${process.arch} has no supported picker target`,
    )
  }
  return target
}

function printEvidence(
  metadata: ManualCandidateMetadata,
  outputPath: string,
): void {
  console.log("Manual candidate evidence:")
  console.log(`Commit SHA: ${metadata.commitSha}`)
  console.log(`Plugin package or tarball: ${metadata.tarball}`)
  console.log(`npm tarball SHA-512: ${metadata.tarballIntegrity}`)
  console.log(`Picker asset path: ${metadata.pickerPath}`)
  console.log(`Picker SHA-256: ${metadata.pickerSha256}`)
  console.log(
    `Retained candidate metadata: ${outputPath}/${manualCandidateMetadataFilename}`,
  )
}

async function gitOutput(arguments_: string[]): Promise<string> {
  const result = await runCaptured(["git", ...arguments_], root)
  return result.stdout.trim()
}

async function runInherited(
  command: string[],
  cwd: string,
  environment: Record<string, string | undefined> = process.env,
): Promise<void> {
  const child = Bun.spawn(command, {
    cwd,
    env: environment,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  })
  const code = await child.exited
  if (code !== 0) {
    throw new Error(`${command.join(" ")} failed with exit code ${code}`)
  }
}

async function runCaptured(
  command: string[],
  cwd: string,
  environment: Record<string, string | undefined> = process.env,
): Promise<{ stdout: string; stderr: string }> {
  const child = Bun.spawn(command, {
    cwd,
    env: environment,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  if (code !== 0) {
    throw new Error(
      `${command.join(" ")} failed with exit code ${code}: ${stderr.trim() || stdout.trim()}`,
    )
  }
  return { stdout, stderr }
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

function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch (error) {
    throw new Error(
      `${label} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function printHelp(): void {
  console.log(`Usage:
  bun run scripts/manual-candidate.ts prepare [--output ${defaultManualCandidateOutput}]
  bun run scripts/manual-candidate.ts install --project <empty-directory> [--output ${defaultManualCandidateOutput}] [--opencode <path>]
  bun run scripts/manual-candidate.ts test [--tui] [--output ${defaultManualCandidateOutput}]

The output directory must stay inside the repository and be ignored by git.`)
}
