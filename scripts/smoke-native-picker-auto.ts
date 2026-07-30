import { access } from "node:fs/promises"
import { fileURLToPath } from "node:url"

import { launchPickerProcess } from "../src/picker-process"
import {
  assertNativePickerSmokePayload,
  nativePickerSmokeRequest,
  PICKER_SMOKE_STARTUP_TIMEOUT_MS,
} from "./picker-smoke-fixture"

if (process.platform !== "linux") {
  throw new Error("Automated native GUI smoke currently requires Linux/X11; use bun run test:gui on other platforms")
}

const binary = fileURLToPath(
  new URL(`../dist-picker/picker-linux-${process.arch}`, import.meta.url),
)
const xdotool = process.env.XDOTOOL_BIN ?? "xdotool"
process.env.GDK_BACKEND = "x11"
delete process.env.WAYLAND_DISPLAY
await Promise.all([access(binary), assertCommandAvailable(xdotool)])

const launched = await launchPickerProcess({
  env: { OPENCODE_MODEL_DISPATCH_PICKER: binary },
  timeoutMs: PICKER_SMOKE_STARTUP_TIMEOUT_MS,
  request: nativePickerSmokeRequest,
})
if (launched.kind === "technical_failure") throw new Error(launched.reason)

try {
  // Rust emits ready as soon as the frontend adapter mounts. Allow the WebKit
  // layout and native select widget to finish painting before pixel-level input.
  await new Promise((resolve) => setTimeout(resolve, 5_000))
  const windowID = await findPickerWindow(xdotool)
  await run([xdotool, "windowfocus", "--sync", windowID])
  // Change the batch model through the real Apply-to-all popover. This proves
  // the shared catalog is wired into the native window instead of silently
  // exercising only the task-row catalogs.
  await run([xdotool, "mousemove", "--window", windowID, "364", "164", "click", "1"])
  await new Promise((resolve) => setTimeout(resolve, 200))
  await run([xdotool, "key", "End"])
  await run([xdotool, "key", "Return"])
  await new Promise((resolve) => setTimeout(resolve, 300))
  // The release window has a fixed 680x500 layout. Operate the Apply-to-all
  // Effort select, choose its final advertised option (High), and commit it.
  await run([xdotool, "mousemove", "--window", windowID, "578", "164", "click", "1"])
  await new Promise((resolve) => setTimeout(resolve, 200))
  await run([xdotool, "key", "End"])
  await run([xdotool, "key", "Return"])
  await new Promise((resolve) => setTimeout(resolve, 250))
  await run([xdotool, "mousemove", "--window", windowID, "605", "345", "click", "1"])

  const decision = await withTimeout(launched.result, 10_000, "Picker did not submit after automated controls")
  if (decision.kind !== "submit") {
    throw new Error(decision.kind === "cancel" ? "Automated picker smoke was cancelled" : decision.reason)
  }
  assertNativePickerSmokePayload(decision.payload)
  console.log("automated native GUI smoke passed: real Tauri window applied one explicit model and effort to every task through its primary controls and production stdio")
} finally {
  launched.process.kill?.()
  await launched.process.exited.catch(() => undefined)
}

async function assertCommandAvailable(command: string): Promise<void> {
  const child = Bun.spawn([command, "version"], { stdout: "ignore", stderr: "ignore" })
  if (await child.exited !== 0) throw new Error(`Required GUI automation command is unavailable: ${command}`)
}

async function findPickerWindow(command: string): Promise<string> {
  const child = Bun.spawn([
    command,
    "search",
    "--sync",
    "--onlyvisible",
    "--limit",
    "1",
    "--name",
    "^Model Dispatch$",
  ], { stdout: "pipe", stderr: "pipe" })
  const outputPromise = new Response(child.stdout).text()
  const errorPromise = new Response(child.stderr).text()
  const timeout = setTimeout(() => child.kill(), 10_000)
  const code = await child.exited
  clearTimeout(timeout)
  const [output, error] = await Promise.all([outputPromise, errorPromise])
  const windowID = output.trim().split(/\s+/)[0]
  if (code !== 0 || !windowID) {
    throw new Error(`Could not find native picker window${error.trim() ? `: ${error.trim()}` : ""}`)
  }
  return windowID
}

async function run(command: string[]): Promise<void> {
  const child = Bun.spawn(command, { stdout: "inherit", stderr: "inherit" })
  const code = await child.exited
  if (code !== 0) throw new Error(`${command.join(" ")} failed with exit code ${code}`)
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
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
