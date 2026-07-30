import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"

import { releasePickerAssets } from "./check-packaging"

export type NativeE2EPreparationMode =
  | "build-local"
  | "exact-tarball"
  | "prebuilt-local"

export function nativeE2EPreparationMode(
  environment: Record<string, string | undefined>,
): NativeE2EPreparationMode {
  if (environment.MODEL_DISPATCH_TEST_PACKAGE_TARBALL?.trim()) {
    return "exact-tarball"
  }
  if (environment.MODEL_DISPATCH_TEST_PREBUILT === "1") {
    return "prebuilt-local"
  }
  return "build-local"
}

export async function assertExactPickerAssets(
  releaseBin: string,
  installedBin: string,
): Promise<void> {
  for (const asset of releasePickerAssets) {
    const sourcePath = join(releaseBin, asset.name)
    const installedPath = join(installedBin, asset.name)
    // Read the canonical release input first so a missing source asset always
    // produces the actionable source-side diagnostic.
    const sourceBytes = await readRequiredAsset(
      sourcePath,
      `release input bin/${asset.name}`,
    )
    const installedBytes = await readRequiredAsset(
      installedPath,
      `installed package bin/${asset.name}`,
    )
    if (!sourceBytes.equals(installedBytes)) {
      throw new Error(
        `Installed package bin/${asset.name} differs from the exact release input`,
      )
    }
  }
}

export async function assertCandidatePickerAssets(options: {
  releaseBin: string
  localPicker: string
  installedBin: string
  localAssetName: string
}): Promise<"complete-release" | "local-candidate"> {
  const knownAssets = new Set(releasePickerAssets.map((asset) => asset.name))
  const installedAssets = (await readdir(options.installedBin))
    .filter((name) => knownAssets.has(name))
    .sort()
  const completeAssets = releasePickerAssets.map((asset) => asset.name).sort()
  if (
    installedAssets.length === completeAssets.length &&
    installedAssets.every((name, index) => name === completeAssets[index])
  ) {
    await assertExactPickerAssets(options.releaseBin, options.installedBin)
    return "complete-release"
  }

  if (
    installedAssets.length !== 1 ||
    installedAssets[0] !== options.localAssetName
  ) {
    throw new Error(
      "Installed candidate must contain either every release picker or exactly "
      + `the local ${options.localAssetName} picker; received ${installedAssets.join(", ") || "none"}`,
    )
  }

  const [sourceBytes, installedBytes] = await Promise.all([
    readRequiredAsset(
      options.localPicker,
      `local candidate ${options.localAssetName}`,
    ),
    readRequiredAsset(
      join(options.installedBin, options.localAssetName),
      `installed package bin/${options.localAssetName}`,
    ),
  ])
  if (!sourceBytes.equals(installedBytes)) {
    throw new Error(
      `Installed package bin/${options.localAssetName} differs from the local candidate picker`,
    )
  }
  return "local-candidate"
}

type ProcessKill = (
  processID: number,
  signal: NodeJS.Signals | 0,
) => boolean

export interface ProcessGroupTerminationOptions {
  gracefulTimeoutMs?: number
  forceTimeoutMs?: number
  pollIntervalMs?: number
  kill?: ProcessKill
  now?: () => number
  sleep?: (milliseconds: number) => Promise<void>
}

export async function terminateDetachedProcessGroup(
  leaderProcessID: number,
  options: ProcessGroupTerminationOptions = {},
): Promise<void> {
  if (!Number.isSafeInteger(leaderProcessID) || leaderProcessID <= 0) {
    throw new Error(`Invalid detached process-group leader pid: ${leaderProcessID}`)
  }

  const kill = options.kill ?? process.kill
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? Bun.sleep
  const gracefulTimeoutMs = boundedDuration(
    options.gracefulTimeoutMs,
    5_000,
    "graceful timeout",
  )
  const forceTimeoutMs = boundedDuration(
    options.forceTimeoutMs,
    5_000,
    "force timeout",
  )
  const pollIntervalMs = boundedDuration(
    options.pollIntervalMs,
    50,
    "poll interval",
    1,
  )
  const processGroupID = -leaderProcessID

  if (!processGroupExists(processGroupID, kill)) return
  signalProcessGroup(processGroupID, "SIGTERM", kill)
  if (
    await waitForProcessGroupExit(
      processGroupID,
      gracefulTimeoutMs,
      pollIntervalMs,
      kill,
      now,
      sleep,
    )
  ) return

  signalProcessGroup(processGroupID, "SIGKILL", kill)
  if (
    await waitForProcessGroupExit(
      processGroupID,
      forceTimeoutMs,
      pollIntervalMs,
      kill,
      now,
      sleep,
    )
  ) return

  throw new Error(
    `Detached integration process group ${leaderProcessID} survived SIGTERM and SIGKILL`,
  )
}

async function readRequiredAsset(path: string, label: string): Promise<Buffer> {
  try {
    return await readFile(path)
  } catch (error) {
    throw new Error(`Could not read ${label}: ${errorMessage(error)}`, {
      cause: error,
    })
  }
}

function processGroupExists(
  processGroupID: number,
  kill: ProcessKill,
): boolean {
  try {
    kill(processGroupID, 0)
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === "ESRCH") return false
    if (code === "EPERM") return true
    throw error
  }
}

function signalProcessGroup(
  processGroupID: number,
  signal: NodeJS.Signals,
  kill: ProcessKill,
): void {
  try {
    kill(processGroupID, signal)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error
  }
}

async function waitForProcessGroupExit(
  processGroupID: number,
  timeoutMs: number,
  pollIntervalMs: number,
  kill: ProcessKill,
  now: () => number,
  sleep: (milliseconds: number) => Promise<void>,
): Promise<boolean> {
  const deadline = now() + timeoutMs
  while (processGroupExists(processGroupID, kill)) {
    const remaining = deadline - now()
    if (remaining <= 0) return false
    await sleep(Math.min(pollIntervalMs, remaining))
  }
  return true
}

function boundedDuration(
  value: number | undefined,
  fallback: number,
  label: string,
  minimum = 0,
): number {
  const duration = value ?? fallback
  if (!Number.isFinite(duration) || duration < minimum) {
    throw new Error(`Invalid process-group ${label}: ${duration}`)
  }
  return duration
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
