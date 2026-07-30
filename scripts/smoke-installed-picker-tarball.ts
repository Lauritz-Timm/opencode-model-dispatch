import { constants } from "node:fs"
import { spawn } from "node:child_process"
import {
  access,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, isAbsolute, join, resolve } from "node:path"
import { Readable } from "node:stream"
import { pathToFileURL } from "node:url"

import { launchPickerProcess } from "../src/picker-process"

const sourceManifest = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
) as {
  name?: unknown
  version?: unknown
  devDependencies?: Record<string, unknown>
}
if (
  typeof sourceManifest.name !== "string" ||
  typeof sourceManifest.version !== "string" ||
  typeof sourceManifest.devDependencies?.["@opencode-ai/plugin"] !== "string"
) {
  throw new Error("Source package manifest is missing release identity pins")
}
const packageName = sourceManifest.name
const packageVersion = sourceManifest.version
const peerVersion = sourceManifest.devDependencies["@opencode-ai/plugin"]
const tarballInput =
  process.env.MODEL_DISPATCH_TEST_PACKAGE_TARBALL?.trim()

if (!tarballInput) {
  throw new Error("MODEL_DISPATCH_TEST_PACKAGE_TARBALL is required")
}

const tarball = isAbsolute(tarballInput)
  ? tarballInput
  : resolve(tarballInput)
await access(tarball, constants.R_OK)

const work = await mkdtemp(
  join(tmpdir(), "model-dispatch-installed-picker-smoke-"),
)

try {
  await writeFile(
    join(work, "package.json"),
    `${JSON.stringify({
      name: "model-dispatch-installed-picker-smoke",
      private: true,
      dependencies: {
        [packageName]: pathToFileURL(tarball).href,
        "@opencode-ai/plugin": peerVersion,
      },
    }, null, 2)}\n`,
    "utf8",
  )
  await run([process.execPath, "install", "--ignore-scripts"], work)

  const packageRoot = join(work, "node_modules", packageName)
  const manifest = JSON.parse(
    await readFile(join(packageRoot, "package.json"), "utf8"),
  ) as { name?: unknown; version?: unknown }
  if (manifest.name !== packageName || manifest.version !== packageVersion) {
    throw new Error(
      `Installed unexpected package ${String(manifest.name)}@${String(manifest.version)}`,
    )
  }

  const platform =
    process.platform === "win32"
      ? "windows"
      : process.platform === "darwin"
        ? "macos"
        : process.platform
  const extension = platform === "windows" ? ".exe" : ""
  const binary = join(
    packageRoot,
    "bin",
    `picker-${platform}-${process.arch}${extension}`,
  )
  await access(
    binary,
    process.platform === "win32" ? constants.F_OK : constants.X_OK,
  )
  const launcher = join(packageRoot, "bin", "picker.js")
  await access(
    launcher,
    process.platform === "win32" ? constants.F_OK : constants.X_OK,
  )
  const launcherEnv = { ...process.env }
  delete launcherEnv.OPENCODE_MODEL_DISPATCH_PICKER

  const launched = await launchPickerProcess({
    binaryRoot: join(packageRoot, "bin"),
    env: { OPENCODE_MODEL_DISPATCH_PICKER: "" },
    spawn: (command) => {
      if (command.length !== 1 || command[0] !== binary) {
        throw new Error(
          `Installed picker resolved ${command.join(" ")}, expected ${binary}`,
        )
      }
      const child = spawn(process.execPath, [launcher], {
        cwd: packageRoot,
        env: launcherEnv,
        stdio: ["pipe", "pipe", "pipe"],
      })
      const exited = new Promise<number | null>((resolveExit, rejectExit) => {
        child.once("error", rejectExit)
        child.once("exit", resolveExit)
      })
      return {
        stdin: {
          write: (chunk: Uint8Array | string) =>
            new Promise<void>((resolveWrite, rejectWrite) => {
              child.stdin.write(chunk, (error) => {
                if (error) rejectWrite(error)
                else resolveWrite()
              })
            }),
        },
        stdout: Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
        stderr: Readable.toWeb(child.stderr) as ReadableStream<Uint8Array>,
        exited,
        kill: () => child.kill(),
      }
    },
    timeoutMs: 30_000,
    request: {
      batchID: "installed-native-ready-smoke",
      sessionID: "installed-native-ready-smoke",
      timeoutMs: 30_000,
      catalog: [{
        providerID: "openai",
        providerName: "OpenAI",
        models: [{
          providerID: "openai",
          providerName: "OpenAI",
          modelID: "smoke",
          modelName: "Installed native ready smoke",
          variants: [],
        }],
      }],
      applyToAllCatalog: [],
      rows: [{ callID: "smoke-task", agentName: "builder" }],
    },
  })

  if (launched.kind === "technical_failure") {
    throw new Error(launched.reason)
  }
  launched.process.kill?.()
  await withTimeout(
    launched.process.exited,
    10_000,
    "Installed native picker did not exit after the ready smoke",
  )
  console.log(
    `installed native ready smoke passed: ${basename(tarball)} launched ${basename(launcher)} and routed ${basename(binary)}`,
  )
} finally {
  await rm(work, { recursive: true, force: true })
}

async function run(command: string[], cwd: string): Promise<void> {
  const child = Bun.spawn(command, {
    cwd,
    env: process.env,
    stdout: "inherit",
    stderr: "inherit",
  })
  const exitCode = await child.exited
  if (exitCode !== 0) {
    throw new Error(`${command.join(" ")} failed with exit code ${exitCode}`)
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  milliseconds: number,
  message: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), milliseconds)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}
