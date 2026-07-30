import { spawn } from "node:child_process"
import { isAbsolute, join } from "node:path"
import { Readable } from "node:stream"
import { fileURLToPath } from "node:url"

import { encodeJsonRpcMessage, parseJsonRpcMessage, technicalFailureFromParseError, type JsonRpcRequest } from "./picker-rpc.js"
import {
  PICKER_TARGETS,
  pickerPlatformForNode,
  pickerTargetForNode,
} from "./picker-targets.js"

export interface TechnicalFailure {
  kind: "technical_failure"
  reason: string
  raw?: string
}

export interface PickerCancel {
  kind: "cancel"
}

export interface PickerSubmit {
  kind: "submit"
  payload: unknown
}

export type PickerDecision = PickerCancel | PickerSubmit | TechnicalFailure

export interface PickerReadySession {
  kind: "ready"
  process: PickerSpawnedProcess
  result: Promise<PickerDecision>
}

export type PickerLaunchResult = PickerReadySession | TechnicalFailure

export interface PickerSpawnedProcess {
  stdin?: PickerStdin | null
  stdout: ReadableStream<Uint8Array> | ReadableStream<string> | null
  stderr?: ReadableStream<Uint8Array> | ReadableStream<string> | null
  exited: Promise<unknown>
  kill?: () => void
}

export type PickerStdin =
  | { getWriter(): { write(chunk: Uint8Array): Promise<unknown> | unknown; releaseLock?: () => void } }
  | {
      write(chunk: Uint8Array | string): Promise<unknown> | unknown
      flush?: () => Promise<unknown> | unknown
    }

export interface PickerTimers {
  setTimeout(callback: () => void, delay: number): unknown
  clearTimeout(handle: unknown): void
}

export interface LaunchPickerProcessOptions {
  binaryRoot?: string
  platform?: string
  arch?: string
  env?: Record<string, string | undefined>
  request?: unknown
  timeoutMs?: number
  decisionTimeoutMs?: number
  spawn?: (command: string[]) => PickerSpawnedProcess
  timers?: PickerTimers
}

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
}

const DEFAULT_TIMEOUT_MS = 20000
const DEFAULT_DECISION_TIMEOUT_MS = 10 * 60 * 1000
const DEFAULT_BINARY_ROOT = fileURLToPath(new URL("../bin/", import.meta.url))
export const MAX_PICKER_RPC_LINE_BYTES = 4 * 1024 * 1024
const DEFAULT_TIMERS: PickerTimers = {
  setTimeout: (callback, delay) => {
    const handle = setTimeout(callback, delay)
    handle.unref?.()
    return handle
  },
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export function resolvePickerBinaryPath(options: { binaryRoot?: string; platform?: string; arch?: string; env?: Record<string, string | undefined> } = {}): string {
  const override = options.env?.OPENCODE_MODEL_DISPATCH_PICKER ?? process.env.OPENCODE_MODEL_DISPATCH_PICKER
  if (override) {
    if (!isAbsolute(override)) {
      throw new Error(
        "OPENCODE_MODEL_DISPATCH_PICKER must be an absolute path to an operator-trusted binary",
      )
    }
    return override
  }
  const binaryRoot = options.binaryRoot ?? DEFAULT_BINARY_ROOT
  const runtimePlatform = options.platform ?? process.platform
  const platform = pickerPlatformForNode(runtimePlatform)
  const arch = options.arch ?? process.arch
  const target = `${platform}-${arch}`
  const pickerTarget = pickerTargetForNode(runtimePlatform, arch)
  if (!pickerTarget) {
    throw new Error(
      `Unsupported bundled picker target ${target}; supported targets are ${PICKER_TARGETS.map(({ platform, arch }) => `${platform}-${arch}`).join(", ")}. Set OPENCODE_MODEL_DISPATCH_PICKER to use a custom binary.`,
    )
  }
  return join(binaryRoot, pickerTarget.assetName)
}

export function launchPickerProcess(options: LaunchPickerProcessOptions = {}): Promise<PickerLaunchResult> {
  const timers = options.timers ?? DEFAULT_TIMERS
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const decisionTimeoutMs =
    options.decisionTimeoutMs ?? DEFAULT_DECISION_TIMEOUT_MS
  const launch = deferred<PickerLaunchResult>()
  const result = deferred<PickerDecision>()
  let launchSettled = false
  let resultSettled = false
  let transportReady = false
  let startSent = false
  let started = false
  let timeout: unknown
  let decisionTimeout: unknown
  let pickerProcess: PickerSpawnedProcess
  let processTerminated = false
  let stderr = ""
  const startRequired = options.request !== undefined && options.request !== null

  const settleLaunch = (value: PickerLaunchResult) => {
    if (launchSettled) return
    launchSettled = true
    timers.clearTimeout(timeout)
    launch.resolve(value)
  }
  const settleResult = (value: PickerDecision) => {
    if (resultSettled) return
    resultSettled = true
    timers.clearTimeout(decisionTimeout)
    result.resolve(value)
  }
  const technicalFailure = (reason: string, raw?: string): TechnicalFailure => ({ kind: "technical_failure", reason, raw })
  const terminate = () => {
    if (processTerminated) return
    processTerminated = true
    pickerProcess.kill?.()
  }
  const fail = (failure: TechnicalFailure) => {
    terminate()
    if (!launchSettled) settleLaunch(failure)
    else settleResult(failure)
  }
  const settleReady = () => {
    if (
      launchSettled ||
      !transportReady ||
      (startRequired && (!startSent || !started))
    ) return
    settleLaunch({ kind: "ready", process: pickerProcess, result: result.promise })
    decisionTimeout = timers.setTimeout(() => {
      terminate()
      settleResult(technicalFailure(
        `Picker decision timeout after ${decisionTimeoutMs}ms`,
      ))
    }, decisionTimeoutMs)
  }

  try {
    const command = [resolvePickerBinaryPath(options)]
    pickerProcess = (options.spawn ?? defaultSpawn)(command)
  } catch (error) {
    return Promise.resolve(technicalFailure(`Picker binary failed to start: ${(error as Error).message}`))
  }

  if (!pickerProcess.stdout) {
    terminate()
    return Promise.resolve(technicalFailure("Picker lost stdio before ready"))
  }
  if (pickerProcess.stderr) {
    void drainStderr(pickerProcess.stderr, (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-8192)
    })
  }

  timeout = timers.setTimeout(() => {
    terminate()
    settleLaunch(technicalFailure(`Picker startup timeout after ${timeoutMs}ms`))
  }, timeoutMs)

  pickerProcess.exited.then(
    (code) => fail(technicalFailure(
      `Picker process exited before decision: ${String(code)}${stderr.trim() ? ` (${stderr.trim()})` : ""}`,
      stderr.trim() || undefined,
    )),
    (error) => fail(technicalFailure(`Picker process exited before decision: ${(error as Error).message}`)),
  )

  readStdout(pickerProcess.stdout, (message) => {
    if (message.method === "ready" && !transportReady) {
      transportReady = true
      if (!startRequired) {
        settleReady()
        return
      }
      void sendStartRequest(pickerProcess, options.request).then(
        () => {
          startSent = true
          settleReady()
        },
        (error) => {
          fail(technicalFailure(`Picker start request failed: ${(error as Error).message}`))
        },
      )
      return
    }

    if (message.method === "started" && transportReady && startRequired) {
      started = true
      settleReady()
      return
    }

    if (!launchSettled) return
    if (message.method === "cancel") {
      settleResult({ kind: "cancel" })
      terminate()
    }
    if (message.method === "submit") {
      settleResult({ kind: "submit", payload: message.params })
      terminate()
    }
  }).then(
    () => fail(technicalFailure(
      !transportReady
        ? "Picker lost stdio before ready"
        : !launchSettled
          ? "Picker lost stdio before acknowledging the start request"
          : "Picker lost stdio before decision",
    )),
    (failure: TechnicalFailure) => fail(failure),
  )

  return launch.promise
}

function defaultSpawn(command: string[]): PickerSpawnedProcess {
  const pickerProcess = spawn(command[0]!, command.slice(1), { stdio: ["pipe", "pipe", "pipe"] })
  const exited = new Promise<number | null>((resolve, reject) => {
    pickerProcess.once("error", reject)
    pickerProcess.once("exit", resolve)
  })
  const stdin: PickerStdin = {
    write: (chunk) => new Promise<void>((resolve, reject) => {
      pickerProcess.stdin.write(chunk, (error) => error ? reject(error) : resolve())
    }),
  }
  return {
    stdin,
    stdout: Readable.toWeb(pickerProcess.stdout) as ReadableStream<Uint8Array>,
    stderr: Readable.toWeb(pickerProcess.stderr) as ReadableStream<Uint8Array>,
    exited,
    kill: () => pickerProcess.kill(),
  }
}

async function drainStderr(
  stream: ReadableStream<Uint8Array> | ReadableStream<string>,
  onChunk: (chunk: string) => void,
): Promise<void> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) {
        const tail = decoder.decode()
        if (tail) onChunk(tail)
        return
      }
      onChunk(typeof next.value === "string" ? next.value : decoder.decode(next.value, { stream: true }))
    }
  } catch {
    // Stderr is diagnostic only; stdout JSON-RPC remains authoritative.
  }
}

async function sendStartRequest(pickerProcess: PickerSpawnedProcess, request: unknown): Promise<void> {
  if (request === undefined || request === null) return
  if (!pickerProcess.stdin) {
    throw new Error("Picker stdin is unavailable")
  }
  const chunk = new TextEncoder().encode(encodeJsonRpcMessage({ jsonrpc: "2.0", method: "start", params: request }))
  if (chunk.byteLength > MAX_PICKER_RPC_LINE_BYTES) {
    throw new Error(`Picker start request exceeds ${MAX_PICKER_RPC_LINE_BYTES} bytes`)
  }
  if ("write" in pickerProcess.stdin) {
    await pickerProcess.stdin.write(chunk)
    await pickerProcess.stdin.flush?.()
    return
  }

  const writer = pickerProcess.stdin.getWriter()
  try {
    await writer.write(chunk)
  } finally {
    writer.releaseLock?.()
  }
}

async function readStdout(stream: ReadableStream<Uint8Array> | ReadableStream<string>, onMessage: (message: JsonRpcRequest) => void): Promise<void> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let fragments: string[] = []
  let bufferedBytes = 0

  const append = (fragment: string) => {
    bufferedBytes += encoder.encode(fragment).byteLength
    if (bufferedBytes > MAX_PICKER_RPC_LINE_BYTES) {
      throw {
        kind: "technical_failure",
        reason: `Picker JSON-RPC line exceeds ${MAX_PICKER_RPC_LINE_BYTES} bytes`,
      } satisfies TechnicalFailure
    }
    if (fragment) fragments.push(fragment)
    if (fragments.length > 1024) fragments = [fragments.join("")]
  }

  const completeLine = (fragment: string) => {
    append(fragment)
    const line = fragments.join("")
    fragments = []
    bufferedBytes = 0
    if (line.length === 0) return
    try {
      const message = parseJsonRpcMessage(line)
      if ("method" in message) onMessage(message)
    } catch (error) {
      throw technicalFailureFromParseError(line, error as Error)
    }
  }

  const consume = (text: string) => {
    const segments = text.split("\n")
    for (let index = 0; index < segments.length - 1; index++) {
      completeLine(segments[index] ?? "")
    }
    append(segments.at(-1) ?? "")
  }

  while (true) {
    const next = await reader.read()
    if (next.done) {
      const tail = decoder.decode()
      if (tail) consume(tail)
      return
    }
    consume(
      typeof next.value === "string"
        ? next.value
        : decoder.decode(next.value, { stream: true }),
    )
  }
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}
