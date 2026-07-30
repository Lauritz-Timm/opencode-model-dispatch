import { createHash } from "node:crypto"
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { describe, expect, test } from "bun:test"

import type { PickerTarget } from "../src/picker-targets"
import {
  discardManualCandidatePromotion,
  invalidateManualCandidate,
  manualCandidateGitIgnorePath,
  manualCandidateInstallSpec,
  manualCandidateTarballFilename,
  parseManualCandidateArguments,
  promoteManualCandidate,
  readManualCandidateMetadata,
  resolveManualCandidateOutput,
  stageManualCandidatePackage,
  verifyManualCandidate,
  type ManualCandidateMetadata,
} from "../scripts/manual-candidate-support"

const linuxX64: PickerTarget = {
  platform: "linux",
  arch: "x64",
  rustTarget: "x86_64-unknown-linux-gnu",
  assetName: "picker-linux-x64",
  format: "elf",
  machine: 0x3e,
  executable: true,
  openCodeIntegration: "verified",
}

describe("manual release candidate support", () => {
  test("checks ignored candidate outputs as directories before they exist", () => {
    expect(manualCandidateGitIgnorePath(".manual-release"))
      .toBe(".manual-release/")
    expect(manualCandidateGitIgnorePath(".manual-release/custom/"))
      .toBe(".manual-release/custom/")
  })

  test("uses a commit- and invocation-unique npm alias for exact installation", () => {
    const metadata = {
      commitSha: "a".repeat(40),
      packageName: "opencode-model-dispatch",
      packageVersion: "0.1.0",
    }
    expect(manualCandidateInstallSpec(metadata, "0123456789abcdef")).toBe(
      "opencode-model-dispatch-manual-aaaaaaaaaaaa-0123456789abcdef"
      + "@npm:opencode-model-dispatch@0.1.0",
    )
    expect(() => manualCandidateInstallSpec(metadata, "not-random"))
      .toThrow("16 lowercase hexadecimal")
  })

  test("gives retained tarballs a commit- and invocation-unique basename", () => {
    expect(manualCandidateTarballFilename(
      "opencode-model-dispatch-0.1.0.tgz",
      "b".repeat(40),
      "fedcba9876543210",
    )).toBe(
      "opencode-model-dispatch-0.1.0-bbbbbbbbbbbb-fedcba9876543210.tgz",
    )
  })

  test("parses prepare, exact scratch install, and retained test commands", () => {
    expect(parseManualCandidateArguments(["prepare"])).toEqual({
      action: "prepare",
      output: ".manual-release",
    })
    expect(parseManualCandidateArguments([
      "install",
      "--project",
      "/tmp/manual-project",
      "--output",
      "dist/manual",
      "--opencode",
      "/opt/opencode",
    ])).toEqual({
      action: "install",
      output: "dist/manual",
      project: "/tmp/manual-project",
      openCode: "/opt/opencode",
    })
    expect(parseManualCandidateArguments(["test", "--tui"])).toEqual({
      action: "test",
      output: ".manual-release",
      tui: true,
    })
    expect(() => parseManualCandidateArguments(["install"]))
      .toThrow("requires --project")
    expect(() => parseManualCandidateArguments(["prepare", "--unknown"]))
      .toThrow("Unknown manual candidate argument")
  })

  test("keeps retained output inside a repository-relative directory", () => {
    const repository = resolve("/tmp/manual-candidate-repository")
    expect(resolveManualCandidateOutput(repository, ".manual-release"))
      .toEqual({
        absolutePath: join(repository, ".manual-release"),
        repositoryPath: ".manual-release",
      })
    expect(() => resolveManualCandidateOutput(repository, ""))
      .toThrow("repository-relative")
    expect(() => resolveManualCandidateOutput(repository, "."))
      .toThrow("inside the repository")
    expect(() => resolveManualCandidateOutput(repository, "../outside"))
      .toThrow("inside the repository")
    expect(() => resolveManualCandidateOutput(repository, resolve("/tmp/outside")))
      .toThrow("repository-relative")
  })

  test("stages only the local picker and excludes stale host artifacts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "model-dispatch-manual-stage-"))
    const repository = join(directory, "repository")
    const stage = join(directory, "stage")
    try {
      await Promise.all([
        mkdir(join(repository, "dist"), { recursive: true }),
        mkdir(join(repository, "dist-picker"), { recursive: true }),
        mkdir(join(repository, "bin"), { recursive: true }),
      ])
      for (const path of [
        "package.json",
        "README.md",
        "LICENSE",
        "THIRD_PARTY_NOTICES.md",
      ]) {
        await writeFile(join(repository, path), path)
      }
      await writeFile(join(repository, "dist", "index.js"), "export default {}")
      await writeFile(join(repository, "bin", "picker.js"), "#!/usr/bin/env node\n")
      await writeFile(join(repository, "bin", "picker-macos-arm64"), "stale")
      await writeFile(
        join(repository, "dist-picker", linuxX64.assetName),
        "fresh-linux-picker",
      )

      await stageManualCandidatePackage({
        repositoryRoot: repository,
        stageRoot: stage,
        picker: linuxX64,
      })

      expect(await readFile(join(stage, "bin", linuxX64.assetName), "utf8"))
        .toBe("fresh-linux-picker")
      expect(await Bun.file(join(stage, "bin", "picker-macos-arm64")).exists())
        .toBe(false)
      if (process.platform !== "win32") {
        expect((await stat(join(stage, "bin", "picker.js"))).mode & 0o111)
          .not.toBe(0)
        expect((await stat(join(stage, "bin", linuxX64.assetName))).mode & 0o111)
          .not.toBe(0)
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("verifies commit-bound tarball and picker hashes and rejects tampering", async () => {
    const directory = await mkdtemp(join(tmpdir(), "model-dispatch-manual-verify-"))
    const repository = join(directory, "repository")
    const output = join(repository, ".manual-release")
    const pickerPath = join(repository, "dist-picker", linuxX64.assetName)
    const tarballPath = join(output, "opencode-model-dispatch-0.1.0.tgz")
    const commitSha = "1".repeat(40)
    try {
      await Promise.all([
        mkdir(join(repository, "dist-picker"), { recursive: true }),
        mkdir(output, { recursive: true }),
      ])
      await writeFile(pickerPath, "candidate-picker")
      await chmod(pickerPath, 0o755)
      await writeFile(tarballPath, "candidate-tarball")
      const metadata: ManualCandidateMetadata = {
        schemaVersion: 1,
        commitSha,
        packageName: "opencode-model-dispatch",
        packageVersion: "0.1.0",
        tarball: "opencode-model-dispatch-0.1.0.tgz",
        tarballIntegrity: integrity("candidate-tarball"),
        pickerPath: `dist-picker/${linuxX64.assetName}`,
        pickerSha256: createHash("sha256")
          .update("candidate-picker")
          .digest("hex"),
      }
      await writeFile(
        join(output, "manual-candidate.json"),
        JSON.stringify(metadata),
      )

      await expect(verifyManualCandidate({
        repositoryRoot: repository,
        outputRoot: output,
        expectedCommit: commitSha,
        picker: linuxX64,
        packageName: metadata.packageName,
        packageVersion: metadata.packageVersion,
      })).resolves.toMatchObject({ metadata })

      await writeFile(tarballPath, "tampered")
      await expect(verifyManualCandidate({
        repositoryRoot: repository,
        outputRoot: output,
        expectedCommit: commitSha,
        picker: linuxX64,
        packageName: metadata.packageName,
        packageVersion: metadata.packageVersion,
      })).rejects.toThrow("tarball no longer matches")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("refuses symlinked metadata without touching its external target", async () => {
    const directory = await mkdtemp(join(tmpdir(), "model-dispatch-manual-metadata-link-"))
    const output = join(directory, "output")
    const externalMetadata = join(directory, "external-metadata.json")
    try {
      await mkdir(output)
      await writeFile(externalMetadata, "external-metadata")
      await symlink(
        externalMetadata,
        join(output, "manual-candidate.json"),
        "file",
      )

      await expect(invalidateManualCandidate(output)).rejects.toThrow(
        "metadata must be a real regular file",
      )
      expect(await readFile(externalMetadata, "utf8")).toBe("external-metadata")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("promotes staged evidence without following a retained tarball symlink", async () => {
    const directory = await mkdtemp(join(tmpdir(), "model-dispatch-manual-promote-"))
    const output = join(directory, "output")
    const staged = join(directory, "staged")
    const externalTarball = join(directory, "external.tgz")
    const tarballFilename = "candidate-deadbeefdead-0123456789abcdef.tgz"
    const stagedTarball = join(staged, tarballFilename)
    const stagedMetadata = join(staged, "manual-candidate.json")
    try {
      await Promise.all([mkdir(output), mkdir(staged)])
      await Promise.all([
        writeFile(externalTarball, "external-tarball"),
        writeFile(stagedTarball, "candidate-tarball"),
        writeFile(stagedMetadata, "{}"),
      ])
      await symlink(
        externalTarball,
        join(output, tarballFilename),
        "file",
      )

      await expect(promoteManualCandidate({
        outputRoot: output,
        stagedTarball,
        stagedMetadata,
        tarballFilename,
      })).rejects.toThrow("already exists and will not be overwritten")
      expect(await readFile(externalTarball, "utf8")).toBe("external-tarball")
      expect(await readFile(stagedTarball, "utf8")).toBe("candidate-tarball")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("atomically promotes and can discard a staged candidate", async () => {
    const directory = await mkdtemp(join(tmpdir(), "model-dispatch-manual-atomic-"))
    const output = join(directory, "output")
    const staged = join(directory, "staged")
    const tarballFilename = "candidate-cafebabecafe-fedcba9876543210.tgz"
    const stagedTarball = join(staged, tarballFilename)
    const stagedMetadata = join(staged, "manual-candidate.json")
    try {
      await Promise.all([mkdir(output), mkdir(staged)])
      await Promise.all([
        writeFile(stagedTarball, "candidate-tarball"),
        writeFile(stagedMetadata, "candidate-metadata"),
      ])

      await expect(promoteManualCandidate({
        outputRoot: output,
        stagedTarball,
        stagedMetadata,
        tarballFilename,
      })).resolves.toEqual({
        tarballPath: join(output, tarballFilename),
        metadataPath: join(output, "manual-candidate.json"),
      })
      expect(await readFile(join(output, tarballFilename), "utf8"))
        .toBe("candidate-tarball")
      expect(await readFile(join(output, "manual-candidate.json"), "utf8"))
        .toBe("candidate-metadata")

      await discardManualCandidatePromotion(output, tarballFilename)
      expect(await Bun.file(join(output, tarballFilename)).exists()).toBe(false)
      expect(await Bun.file(join(output, "manual-candidate.json")).exists())
        .toBe(false)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("validates evidence metadata before using retained paths", () => {
    const valid = {
      schemaVersion: 1,
      commitSha: "a".repeat(40),
      packageName: "opencode-model-dispatch",
      packageVersion: "0.1.0",
      tarball: "opencode-model-dispatch-0.1.0.tgz",
      tarballIntegrity: `sha512-${"A".repeat(86)}==`,
      pickerPath: "dist-picker/picker-linux-x64",
      pickerSha256: "b".repeat(64),
    }
    expect(readManualCandidateMetadata(valid)).toEqual(valid)
    expect(() => readManualCandidateMetadata({
      ...valid,
      tarball: "../candidate.tgz",
    })).toThrow("safe .tgz basename")
    expect(() => readManualCandidateMetadata({
      ...valid,
      pickerPath: "/tmp/picker",
    })).toThrow("dist-picker repository path")
  })

  test("publishes the preparation, install, and exact-tarball test scripts", async () => {
    const packageJson = JSON.parse(
      await Bun.file(new URL("../package.json", import.meta.url)).text(),
    ) as { scripts?: Record<string, string> }
    const commandSource = await Bun.file(
      new URL("../scripts/manual-candidate.ts", import.meta.url),
    ).text()
    expect(packageJson.scripts?.["release:manual-candidate"]).toBe(
      "bun run scripts/manual-candidate.ts prepare",
    )
    expect(packageJson.scripts?.["release:manual-candidate:install"]).toBe(
      "bun run scripts/manual-candidate.ts install",
    )
    expect(packageJson.scripts?.["release:manual-candidate:test"]).toBe(
      "bun run scripts/manual-candidate.ts test",
    )
    expect(packageJson.scripts?.["release:manual-candidate:test:tui"]).toBe(
      "bun run scripts/manual-candidate.ts test --tui",
    )
    expect(commandSource).toContain(
      'await import("./local-npm-registry")',
    )
    expect(commandSource).not.toMatch(
      /import\s+\{[^}]*startLocalNpmRegistry[^}]*\}\s+from\s+"\.\/local-npm-registry"/s,
    )
    expect(commandSource.indexOf("const finalCommitSha")).toBeLessThan(
      commandSource.indexOf("await promoteManualCandidate"),
    )
    expect(commandSource).toContain(
      '[openCode, "plugin", packageSpec, "--pure"]',
    )
  })
})

function integrity(value: string): string {
  return `sha512-${createHash("sha512").update(value).digest("base64")}`
}
