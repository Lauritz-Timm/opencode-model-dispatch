import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { releasePickerAssets } from "../scripts/check-packaging"
import {
  assertCandidatePickerAssets,
  assertExactPickerAssets,
  nativeE2EPreparationMode,
  terminateDetachedProcessGroup,
} from "../scripts/installed-native-opencode-support"

describe("installed native OpenCode integration support", () => {
  test("chooses a fresh local build unless an exact tarball or explicit prebuilt contract is supplied", () => {
    expect(nativeE2EPreparationMode({})).toBe("build-local")
    expect(nativeE2EPreparationMode({
      MODEL_DISPATCH_TEST_PREBUILT: "1",
    })).toBe("prebuilt-local")
    expect(nativeE2EPreparationMode({
      MODEL_DISPATCH_TEST_PACKAGE_TARBALL: "/tmp/release.tgz",
      MODEL_DISPATCH_TEST_PREBUILT: "1",
    })).toBe("exact-tarball")
    expect(nativeE2EPreparationMode({
      MODEL_DISPATCH_TEST_PACKAGE_TARBALL: "  ",
    })).toBe("build-local")
  })

  test("wires the package command through the fresh-build wrapper and detached-group cleanup", async () => {
    const packageJson = JSON.parse(
      await Bun.file(new URL("../package.json", import.meta.url)).text(),
    ) as { scripts?: Record<string, string> }
    const wrapper = await Bun.file(
      new URL("../scripts/run-installed-native-opencode.ts", import.meta.url),
    ).text()
    const integration = await Bun.file(
      new URL("../scripts/test-installed-native-opencode.ts", import.meta.url),
    ).text()

    expect(packageJson.scripts?.["test:package:native:opencode"]).toBe(
      "bun run scripts/run-installed-native-opencode.ts",
    )
    expect(wrapper).toContain('"build-local"')
    expect(wrapper).toContain('"build:picker"')
    expect(wrapper).toContain('"exact-tarball"')
    expect(integration).toContain("detached: true")
    expect(integration).toContain("terminateDetachedProcessGroup")
    expect(integration).toContain('process.on(signal')
    expect(integration).toContain("MODEL_DISPATCH_TEST_PLUGIN_PACKAGE")
    expect(integration).toContain("MODEL_DISPATCH_TEST_PLUGIN_TARBALL")
    expect(integration).not.toContain("MODEL_DISPATCH_TEST_PLUGIN_ENTRY")
    expect(integration).toContain('"--offline"')
    expect(integration).toContain('"--no-audit"')
    expect(integration).toContain('"--ignore-scripts"')
    expect(integration).toContain('"--package-lock=false"')
  })

  test("requires every installed picker to be byte-identical to its release input", async () => {
    const directory = await mkdtemp(join(tmpdir(), "model-dispatch-exact-assets-"))
    const releaseBin = join(directory, "release-bin")
    const installedBin = join(directory, "installed-bin")
    await Promise.all([
      mkdir(releaseBin, { recursive: true }),
      mkdir(installedBin, { recursive: true }),
    ])

    try {
      for (const [index, asset] of releasePickerAssets.entries()) {
        const bytes = new Uint8Array([index, 1, 2, 3, 4])
        await Promise.all([
          writeFile(join(releaseBin, asset.name), bytes),
          writeFile(join(installedBin, asset.name), bytes),
        ])
      }

      await expect(
        assertExactPickerAssets(releaseBin, installedBin),
      ).resolves.toBeUndefined()

      await writeFile(
        join(installedBin, "picker-macos-arm64"),
        new Uint8Array([9, 9, 9]),
      )
      await expect(
        assertExactPickerAssets(releaseBin, installedBin),
      ).rejects.toThrow(
        "Installed package bin/picker-macos-arm64 differs from the exact release input",
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("fails when any exact release input is absent", async () => {
    const directory = await mkdtemp(join(tmpdir(), "model-dispatch-missing-asset-"))
    const releaseBin = join(directory, "release-bin")
    const installedBin = join(directory, "installed-bin")
    await Promise.all([
      mkdir(releaseBin, { recursive: true }),
      mkdir(installedBin, { recursive: true }),
    ])

    try {
      await expect(
        assertExactPickerAssets(releaseBin, installedBin),
      ).rejects.toThrow("release input bin/picker-linux-x64")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("accepts only a byte-identical local picker or the complete release set", async () => {
    const directory = await mkdtemp(join(tmpdir(), "model-dispatch-local-candidate-"))
    const releaseBin = join(directory, "release-bin")
    const installedBin = join(directory, "installed-bin")
    const localPicker = join(directory, "picker-linux-x64")
    await Promise.all([
      mkdir(releaseBin, { recursive: true }),
      mkdir(installedBin, { recursive: true }),
    ])

    try {
      await writeFile(localPicker, new Uint8Array([1, 2, 3, 4]))
      await writeFile(
        join(installedBin, "picker-linux-x64"),
        new Uint8Array([1, 2, 3, 4]),
      )
      await expect(assertCandidatePickerAssets({
        releaseBin,
        localPicker,
        installedBin,
        localAssetName: "picker-linux-x64",
      })).resolves.toBe("local-candidate")

      await writeFile(
        join(installedBin, "picker-windows-x64.exe"),
        new Uint8Array([5, 6, 7]),
      )
      await expect(assertCandidatePickerAssets({
        releaseBin,
        localPicker,
        installedBin,
        localAssetName: "picker-linux-x64",
      })).rejects.toThrow(
        "either every release picker or exactly the local picker-linux-x64",
      )

      await rm(installedBin, { recursive: true, force: true })
      await mkdir(installedBin)
      for (const [index, asset] of releasePickerAssets.entries()) {
        const bytes = new Uint8Array([index, 8, 9])
        await Promise.all([
          writeFile(join(releaseBin, asset.name), bytes),
          writeFile(join(installedBin, asset.name), bytes),
        ])
      }
      await expect(assertCandidatePickerAssets({
        releaseBin,
        localPicker,
        installedBin,
        localAssetName: "picker-linux-x64",
      })).resolves.toBe("complete-release")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("terminates a detached integration group gracefully", async () => {
    let running = true
    const signals: Array<NodeJS.Signals | 0> = []

    await terminateDetachedProcessGroup(42, {
      gracefulTimeoutMs: 5,
      forceTimeoutMs: 5,
      pollIntervalMs: 1,
      kill: (processID, signal) => {
        expect(processID).toBe(-42)
        if (signal === 0 && !running) throw missingProcessError()
        if (signal !== 0) {
          signals.push(signal)
          running = false
        }
        return true
      },
      now: () => 0,
      sleep: async () => {},
    })

    expect(signals).toEqual(["SIGTERM"])
  })

  test("forces a detached integration group that ignores SIGTERM", async () => {
    let running = true
    let now = 0
    const signals: Array<NodeJS.Signals | 0> = []

    await terminateDetachedProcessGroup(73, {
      gracefulTimeoutMs: 3,
      forceTimeoutMs: 3,
      pollIntervalMs: 1,
      kill: (processID, signal) => {
        expect(processID).toBe(-73)
        if (signal === 0 && !running) throw missingProcessError()
        if (signal !== 0) {
          signals.push(signal)
          if (signal === "SIGKILL") running = false
        }
        return true
      },
      now: () => now,
      sleep: async (milliseconds) => {
        now += milliseconds
      },
    })

    expect(signals).toEqual(["SIGTERM", "SIGKILL"])
  })

  test("removes a real detached Linux process group and its descendant", async () => {
    if (process.platform !== "linux") return

    const directory = await mkdtemp(join(tmpdir(), "model-dispatch-process-group-"))
    const descendantPIDPath = join(directory, "descendant.pid")
    const child = Bun.spawn(
      [
        "/bin/sh",
        "-c",
        'sleep 30 & printf "%s\\n" "$!" > "$1"; wait',
        "model-dispatch-process-group-test",
        descendantPIDPath,
      ],
      {
        detached: true,
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      },
    )

    try {
      const descendantPID = await waitForProcessID(descendantPIDPath)
      await terminateDetachedProcessGroup(child.pid, {
        gracefulTimeoutMs: 1_000,
        forceTimeoutMs: 2_000,
      })
      await child.exited

      expect(processExists(child.pid)).toBe(false)
      expect(processExists(descendantPID)).toBe(false)
    } finally {
      try {
        process.kill(-child.pid, "SIGKILL")
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error
      }
      await rm(directory, { recursive: true, force: true })
    }
  })
})

function missingProcessError(): NodeJS.ErrnoException {
  return Object.assign(new Error("No such process"), { code: "ESRCH" })
}

async function waitForProcessID(path: string): Promise<number> {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    try {
      const processID = Number.parseInt((await readFile(path, "utf8")).trim(), 10)
      if (Number.isSafeInteger(processID) && processID > 0) return processID
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
    await Bun.sleep(10)
  }
  throw new Error("Detached process-group fixture did not report its descendant pid")
}

function processExists(processID: number): boolean {
  try {
    process.kill(processID, 0)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false
    throw error
  }
}
