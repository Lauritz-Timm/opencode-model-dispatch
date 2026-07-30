import { access, chmod, cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import { constants } from "node:fs"
import { tmpdir } from "node:os"
import { basename, isAbsolute, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import {
  assertExactPickerAssets,
  terminateDetachedProcessGroup,
} from "./installed-native-opencode-support"

if (process.platform !== "linux") {
  throw new Error("Installed-package native OpenCode automation currently requires Linux/X11")
}

const PICKER_WINDOW_TIMEOUT_MS = 180_000
const INTEGRATION_COMPLETION_TIMEOUT_MS = 240_000
const PROCESS_EXIT_TIMEOUT_MS = 10_000
const root = fileURLToPath(new URL("../", import.meta.url))
const work = await mkdtemp(join(tmpdir(), "model-dispatch-installed-native-"))
const packageStage = join(work, "package")
const packOutput = join(work, "pack")
const installRoot = join(work, "consumer")
const npmCache = join(work, "npm-cache")
const assetName = `picker-linux-${process.arch}`
const xdotool = process.env.XDOTOOL_BIN ?? "xdotool"
const guiSettleMs = Number(process.env.MODEL_DISPATCH_TEST_GUI_SETTLE_MS ?? "1500")
const providedTarball =
  process.env.MODEL_DISPATCH_TEST_PACKAGE_TARBALL?.trim() || undefined
const useTui = process.env.MODEL_DISPATCH_TEST_TUI === "1"
let integration: ReturnType<typeof Bun.spawn> | undefined
let stdoutText: Promise<string> | undefined
let stderrText: Promise<string> | undefined
let integrationGroupStopped = false
let integrationCleanup: Promise<void> | undefined
let handlingTerminationSignal = false

for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void handleTerminationSignal(signal)
  })
}

try {
  if (!providedTarball && process.env.MODEL_DISPATCH_TEST_PREBUILT !== "1") {
    throw new Error(
      "Local installed-package native integration requires freshly prepared artifacts. Run bun run test:package:native:opencode instead of invoking this internal script directly.",
    )
  }
  await assertCommandAvailable(xdotool)
  let tarballPath: string
  let nativeAsset: string | undefined
  if (providedTarball) {
    tarballPath = isAbsolute(providedTarball)
      ? providedTarball
      : resolve(root, providedTarball)
    await access(tarballPath, constants.R_OK)
  } else {
    nativeAsset = await firstExecutable([
      join(root, "dist-picker", assetName),
    ])
    await stagePackage(nativeAsset)
    await mkdir(packOutput, { recursive: true })
    await run(
      ["npm", "pack", "--silent", "--ignore-scripts", "--pack-destination", packOutput, packageStage],
      { ...process.env, npm_config_cache: npmCache },
    )

    const tarballs = Array.from(new Bun.Glob("*.tgz").scanSync(packOutput))
    if (tarballs.length !== 1) {
      throw new Error(`Expected one staged npm tarball, found ${tarballs.length}`)
    }
    tarballPath = join(packOutput, tarballs[0]!)
  }
  await mkdir(installRoot, { recursive: true })
  await run([
    "npm",
    "install",
    "--ignore-scripts",
    "--omit=dev",
    "--legacy-peer-deps",
    "--offline",
    "--no-audit",
    "--no-fund",
    "--package-lock=false",
    "--prefix",
    installRoot,
    tarballPath,
  ], {
    ...process.env,
    npm_config_cache: npmCache,
  })

  const installedPackage = join(
    installRoot,
    "node_modules",
    "opencode-model-dispatch",
  )
  const installedPlugin = join(installedPackage, "dist", "index.js")
  const installedPicker = join(installedPackage, "bin", assetName)
  await Promise.all([
    access(installedPlugin, constants.R_OK),
    access(installedPicker, constants.X_OK),
  ])
  if (providedTarball) {
    await assertExactPickerAssets(
      join(root, "bin"),
      join(installedPackage, "bin"),
    )
  } else {
    const [sourceBytes, installedBytes] = await Promise.all([
      readFile(nativeAsset!),
      readFile(installedPicker),
    ])
    if (!sourceBytes.equals(installedBytes)) {
      throw new Error("Installed native picker bytes differ from the staged release asset")
    }
  }

  const environment: Record<string, string | undefined> = {
    ...process.env,
    GDK_BACKEND: "x11",
    MODEL_DISPATCH_TEST_PLUGIN_PACKAGE: installedPackage,
    MODEL_DISPATCH_TEST_PLUGIN_TARBALL: tarballPath,
    MODEL_DISPATCH_TEST_USE_BUNDLED_PICKER: "1",
  }
  delete environment.OPENCODE_MODEL_DISPATCH_PICKER
  delete environment.OPENCODE_MODEL_DISPATCH_PICKER_EVIDENCE
  delete environment.WAYLAND_DISPLAY

  integration = Bun.spawn(
    [process.execPath, join(root, "scripts", "test-opencode-server.ts")],
    {
      cwd: root,
      env: environment,
      stdout: "pipe",
      stderr: "pipe",
      detached: true,
    },
  )
  stdoutText = new Response(
    integration.stdout as ReadableStream<Uint8Array>,
  ).text()
  stderrText = new Response(
    integration.stderr as ReadableStream<Uint8Array>,
  ).text()

  const windowID = await findPickerWindow(xdotool, integration)
  // The native adapter reports ready before WebKit has necessarily painted the
  // final layout. Wait briefly before driving its real keyboard controls.
  await Bun.sleep(Number.isFinite(guiSettleMs) && guiSettleMs >= 0 ? guiSettleMs : 1_500)
  await run([xdotool, "windowfocus", "--sync", windowID], process.env)

  // An inert click establishes WebKit's sequential focus at the picker panel.
  // Its first two enabled controls are apply-to-all model and task model; both
  // effort controls start disabled. Open the task popover and search for the
  // exact child model rather than depending on catalog order.
  await run(
    [xdotool, "mousemove", "--window", windowID, "40", "100", "click", "1"],
    process.env,
  )
  await run([xdotool, "key", "Tab", "Tab"], process.env)
  await run([xdotool, "key", "Down"], process.env)
  await Bun.sleep(200)
  await run(
    [xdotool, "type", "--clearmodifiers", "--delay", "10", "child-model"],
    process.env,
  )
  await run([xdotool, "key", "Return"], process.env)
  await Bun.sleep(300)

  // Selecting the child model enables its adjacent native effort select. End
  // changes it to the final advertised value (High) immediately; Return would
  // reopen the platform select on WebKitGTK, so advance without it.
  await run([xdotool, "key", "Tab"], process.env)
  await run([xdotool, "key", "End"], process.env)
  await Bun.sleep(250)

  // Tab across Cancel to the real primary action and submit. A disabled
  // primary action cannot be activated, so this also proves both interactions
  // produced a valid selection.
  if (await windowExists(xdotool, windowID)) {
    await run([xdotool, "key", "Tab", "Tab", "Return"], process.env)
  }

  const code = await withTimeout(
    integration.exited,
    INTEGRATION_COMPLETION_TIMEOUT_MS,
    "Installed-package OpenCode integration did not finish",
  )
  await cleanupIntegrationProcessGroup()
  const [stdout, stderr] = await Promise.all([stdoutText, stderrText])
  if (code !== 0) {
    throw new Error(
      `Installed-package OpenCode integration exited ${code}\nstdout:\n${stdout.slice(-12_000)}\nstderr:\n${stderr.slice(-12_000)}`,
    )
  }
  if (
    !stdout.includes("loaded the installed npm package by its documented package name") ||
    !stdout.includes("through the bundled native picker") ||
    (useTui && !stdout.includes("from a prompt entered through its PTY-backed TUI"))
  ) {
    throw new Error(`Integration output did not prove the installed native path:\n${stdout}`)
  }

  console.log(stdout.trim())
  console.log(
    `installed native package${useTui ? " TUI" : ""} integration passed: ${basename(tarballPath)} resolved by real OpenCode from plugin: ["opencode-model-dispatch"] and submitted model + effort through the packaged Tauri picker`,
  )
} catch (error) {
  let cleanupError: unknown
  try {
    await cleanupIntegrationProcessGroup()
  } catch (candidate) {
    cleanupError = candidate
  }
  const output = Promise.all([
    stdoutText?.catch(() => "") ?? "",
    stderrText?.catch(() => "") ?? "",
  ])
  const [stdout, stderr] = cleanupError
    ? await withTimeout(
        output,
        2_000,
        "Integration output streams remained open after failed process-group cleanup",
      ).catch(() => ["", ""] as const)
    : await output
  if (stdout) console.error(stdout.slice(-12_000))
  if (stderr) console.error(stderr.slice(-12_000))
  if (cleanupError) {
    throw new AggregateError(
      [error, cleanupError],
      "Installed-package integration failed and its detached process group could not be cleaned up",
    )
  }
  throw error
} finally {
  try {
    await cleanupIntegrationProcessGroup()
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

async function stagePackage(nativeAsset: string): Promise<void> {
  await mkdir(join(packageStage, "bin"), { recursive: true })
  for (const path of [
    "package.json",
    "README.md",
    "LICENSE",
    "THIRD_PARTY_NOTICES.md",
  ]) {
    await cp(join(root, path), join(packageStage, path))
  }
  for (const path of ["dist", "assets", "bin"]) {
    await cp(join(root, path), join(packageStage, path), {
      recursive: true,
      force: true,
    })
  }
  const stagedPicker = join(packageStage, "bin", assetName)
  await cp(nativeAsset, stagedPicker, { force: true })
  await chmod(join(packageStage, "bin", "picker.js"), 0o755)
  await chmod(stagedPicker, 0o755)
}

async function firstExecutable(candidates: string[]): Promise<string> {
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK)
      return candidate
    } catch {
      // Continue to the next release-asset location.
    }
  }
  throw new Error(
    `Built native picker not found; checked ${candidates.join(", ")}. Run bun run build:picker first.`,
  )
}

async function assertCommandAvailable(command: string): Promise<void> {
  const child = Bun.spawn([command, "version"], {
    stdout: "ignore",
    stderr: "ignore",
  })
  if (await child.exited !== 0) {
    throw new Error(`Required GUI automation command is unavailable: ${command}`)
  }
}

async function findPickerWindow(
  command: string,
  integrationProcess: ReturnType<typeof Bun.spawn>,
): Promise<string> {
  const deadline = Date.now() + PICKER_WINDOW_TIMEOUT_MS
  const startedAt = Date.now()
  let lastError = ""
  let processSnapshot = ""
  while (Date.now() < deadline) {
    if (!processSnapshot && Date.now() - startedAt > 30_000) {
      processSnapshot = await captureProcessSnapshot()
    }
    if (integrationProcess.exitCode !== null) {
      const [stdout, stderr] = await Promise.all([
        stdoutText ?? Promise.resolve(""),
        stderrText ?? Promise.resolve(""),
      ])
      throw new Error(
        `OpenCode integration exited ${integrationProcess.exitCode} before opening the picker\nprocesses:\n${processSnapshot || await captureProcessSnapshot()}\nstdout:\n${stdout.slice(-12_000)}\nstderr:\n${stderr.slice(-12_000)}`,
      )
    }
    const child = Bun.spawn([
      command,
      "search",
      "--onlyvisible",
      "--limit",
      "1",
      "--name",
      "^Model Dispatch$",
    ], {
      stdout: "pipe",
      stderr: "pipe",
    })
    const [code, output, error] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    const windowID = output.trim().split(/\s+/)[0]
    if (code === 0 && windowID) return windowID
    lastError = error.trim()
    await Bun.sleep(250)
  }
  throw new Error(
    `Could not find installed native picker window within ${PICKER_WINDOW_TIMEOUT_MS / 1_000}s${lastError ? `: ${lastError}` : ""}\nprocesses:\n${processSnapshot || await captureProcessSnapshot()}`,
  )
}

async function cleanupIntegrationProcessGroup(): Promise<void> {
  if (!integration || integrationGroupStopped) return
  if (integrationCleanup) return await integrationCleanup

  const cleanup = (async () => {
    await terminateDetachedProcessGroup(integration!.pid)
    integrationGroupStopped = true
    await withTimeout(
      integration!.exited,
      PROCESS_EXIT_TIMEOUT_MS,
      "Detached OpenCode integration leader did not report exit after process-group cleanup",
    )
  })()
  integrationCleanup = cleanup
  try {
    await cleanup
  } catch (error) {
    if (integrationCleanup === cleanup) integrationCleanup = undefined
    throw error
  }
}

async function handleTerminationSignal(
  signal: "SIGHUP" | "SIGINT" | "SIGTERM",
): Promise<never> {
  if (handlingTerminationSignal) {
    return await new Promise<never>(() => {})
  }
  handlingTerminationSignal = true
  try {
    await cleanupIntegrationProcessGroup()
  } catch (error) {
    console.error(
      `Failed to clean detached integration processes after ${signal}: ${error instanceof Error ? error.message : String(error)}`,
    )
  } finally {
    await rm(work, { recursive: true, force: true })
  }

  const exitCode = signal === "SIGHUP" ? 129 : signal === "SIGINT" ? 130 : 143
  process.exit(exitCode)
}

async function captureProcessSnapshot(): Promise<string> {
  const child = Bun.spawn(
    ["ps", "-eo", "pid,ppid,stat,comm,args"],
    { stdout: "pipe", stderr: "pipe" },
  )
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  if (code !== 0) return `ps failed (${code}): ${stderr.trim()}`
  return stdout
    .split("\n")
    .filter((line) => /picker|opencode|model-dispatch/i.test(line))
    .join("\n")
}

async function windowExists(command: string, windowID: string): Promise<boolean> {
  const child = Bun.spawn([command, "getwindowname", windowID], {
    stdout: "ignore",
    stderr: "ignore",
  })
  return await child.exited === 0
}

async function run(
  command: string[],
  env: Record<string, string | undefined>,
): Promise<void> {
  const child = Bun.spawn(command, {
    cwd: root,
    env,
    stdout: "inherit",
    stderr: "inherit",
  })
  const code = await child.exited
  if (code !== 0) {
    throw new Error(`${command.join(" ")} failed with exit code ${code}`)
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}
