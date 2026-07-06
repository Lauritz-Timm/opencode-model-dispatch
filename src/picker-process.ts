import { join } from "node:path"

import { encodeJsonRpcMessage, parseJsonRpcMessage, technicalFailureFromParseError, type JsonRpcRequest } from "./picker-rpc"

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
  exited: Promise<unknown>
  kill?: () => void
}

export type PickerStdin =
  | { getWriter(): { write(chunk: Uint8Array): Promise<unknown> | unknown; releaseLock?: () => void } }
  | { write(chunk: Uint8Array | string): Promise<unknown> | unknown }

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
  spawn?: (command: string[]) => PickerSpawnedProcess
  timers?: PickerTimers
}

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
}

const DEFAULT_TIMEOUT_MS = 20000
const DEFAULT_TIMERS: PickerTimers = {
  setTimeout: (callback, delay) => setTimeout(callback, delay),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export function resolvePickerBinaryPath(options: { binaryRoot?: string; platform?: string; arch?: string; env?: Record<string, string | undefined> } = {}): string {
  const override = options.env?.OPENCODE_MODEL_DISPATCH_PICKER ?? process.env.OPENCODE_MODEL_DISPATCH_PICKER
  if (override) return override
  const binaryRoot = options.binaryRoot ?? join(import.meta.dir, "..", "bin")
  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  const extension = platform === "win32" || platform === "windows" ? ".exe" : ""
  return join(binaryRoot, `picker-${platform}-${arch}${extension}`)
}

export function launchPickerProcess(options: LaunchPickerProcessOptions = {}): Promise<PickerLaunchResult> {
  const timers = options.timers ?? DEFAULT_TIMERS
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const command = [resolvePickerBinaryPath(options)]
  const launch = deferred<PickerLaunchResult>()
  const result = deferred<PickerDecision>()
  let launchSettled = false
  let resultSettled = false
  let ready = false
  let timeout: unknown
  let pickerProcess: PickerSpawnedProcess

  const settleLaunch = (value: PickerLaunchResult) => {
    if (launchSettled) return
    launchSettled = true
    timers.clearTimeout(timeout)
    launch.resolve(value)
  }
  const settleResult = (value: PickerDecision) => {
    if (resultSettled) return
    resultSettled = true
    result.resolve(value)
  }
  const technicalFailure = (reason: string, raw?: string): TechnicalFailure => ({ kind: "technical_failure", reason, raw })
  const fail = (failure: TechnicalFailure) => {
    if (!ready) settleLaunch(failure)
    else settleResult(failure)
  }

  try {
    pickerProcess = (options.spawn ?? defaultSpawn)(command)
  } catch (error) {
    return Promise.resolve(technicalFailure(`Picker binary failed to start: ${(error as Error).message}`))
  }

  if (!pickerProcess.stdout) {
    return Promise.resolve(technicalFailure("Picker lost stdio before ready"))
  }

  timeout = timers.setTimeout(() => {
    pickerProcess.kill?.()
    settleLaunch(technicalFailure(`Picker startup timeout after ${timeoutMs}ms`))
  }, timeoutMs)

  pickerProcess.exited.then(
    (code) => fail(technicalFailure(`Picker process exited before decision: ${String(code)}`)),
    (error) => fail(technicalFailure(`Picker process exited before decision: ${(error as Error).message}`)),
  )

  readStdout(pickerProcess.stdout, (message) => {
    if (message.method === "ready" && !ready) {
      ready = true
      void sendStartRequest(pickerProcess, options.request)
      settleLaunch({ kind: "ready", process: pickerProcess, result: result.promise })
      return
    }

    if (!ready) return
    if (message.method === "cancel") settleResult({ kind: "cancel" })
    if (message.method === "submit") settleResult({ kind: "submit", payload: message.params })
  }).then(
    () => fail(technicalFailure(ready ? "Picker lost stdio before decision" : "Picker lost stdio before ready")),
    (failure: TechnicalFailure) => fail(failure),
  )

  return launch.promise
}

function defaultSpawn(command: string[]): PickerSpawnedProcess {
  const pickerProcess = Bun.spawn(command, { stdin: "pipe", stdout: "pipe", stderr: "pipe" })
  return { stdin: pickerProcess.stdin as PickerStdin, stdout: pickerProcess.stdout, exited: pickerProcess.exited, kill: () => pickerProcess.kill() }
}

async function sendStartRequest(pickerProcess: PickerSpawnedProcess, request: unknown): Promise<void> {
  if (!request || !pickerProcess.stdin) return
  const chunk = new TextEncoder().encode(encodeJsonRpcMessage({ jsonrpc: "2.0", method: "start", params: request }))
  if ("write" in pickerProcess.stdin) {
    await pickerProcess.stdin.write(chunk)
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
  let buffer = ""

  while (true) {
    const next = await reader.read()
    if (next.done) return
    buffer += typeof next.value === "string" ? next.value : decoder.decode(next.value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""

    for (const line of lines) {
      if (line.length === 0) continue
      try {
        const message = parseJsonRpcMessage(line)
        if ("method" in message) onMessage(message)
      } catch (error) {
        throw technicalFailureFromParseError(line, error as Error)
      }
    }
  }
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}
