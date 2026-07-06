import { describe, expect, test } from "bun:test"

import { launchPickerProcess, resolvePickerBinaryPath } from "../src/picker-process"

type TimerHandle = number

class ManualTimers {
  readonly delays: number[] = []
  private readonly callbacks = new Map<TimerHandle, () => void>()
  private nextHandle = 1

  setTimeout(callback: () => void, delay: number): TimerHandle {
    const handle = this.nextHandle++
    this.delays.push(delay)
    this.callbacks.set(handle, callback)
    return handle
  }

  clearTimeout(handle: TimerHandle): void {
    this.callbacks.delete(handle)
  }

  activeCount(): number {
    return this.callbacks.size
  }

  fireAll(): void {
    for (const callback of Array.from(this.callbacks.values())) callback()
  }
}

function createStdout() {
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(nextController) {
      controller = nextController
    },
  })

  return {
    stream,
    send(line: string) {
      controller?.enqueue(encoder.encode(line))
    },
    close() {
      controller?.close()
    },
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

async function isSettled<T>(promise: Promise<T>): Promise<boolean> {
  const sentinel = Symbol("pending")
  return (await Promise.race([promise, Promise.resolve(sentinel)])) !== sentinel
}

describe("picker process manager", () => {
  test("starts the platform picker binary and waits for ready", async () => {
    const stdout = createStdout()
    const exited = deferred<number>()
    const timers = new ManualTimers()
    let command: string[] | undefined

    const launch = launchPickerProcess({
      binaryRoot: "/package/bin",
      platform: "linux",
      arch: "x64",
      timers,
      spawn(nextCommand) {
        command = nextCommand
        return { stdout: stdout.stream, exited: exited.promise }
      },
    })

    expect(command?.[0]).toContain("picker-linux-x64")
    expect(await isSettled(launch)).toBe(false)

    stdout.send('{"jsonrpc":"2.0","method":"ready"}\n')

    const session = await launch
    expect(session.kind).toBe("ready")
  })

  test("uses explicit picker binary override before packaged binary path", () => {
    expect(resolvePickerBinaryPath({ env: { OPENCODE_MODEL_DISPATCH_PICKER: "/tmp/custom-picker" } })).toBe("/tmp/custom-picker")
  })

  test("sends the picker request over stdin after ready", async () => {
    const stdout = createStdout()
    const writes: string[] = []
    const writer = {
      write(chunk: Uint8Array) {
        writes.push(new TextDecoder().decode(chunk))
        return Promise.resolve()
      },
      close() {
        return Promise.resolve()
      },
    }

    const launch = launchPickerProcess({
      request: { sessionID: "parent", rows: [{ callID: "call-1" }] },
      spawn() {
        return {
          stdout: stdout.stream,
          stdin: { getWriter: () => writer },
          exited: new Promise<number>(() => {}),
        }
      },
    })

    stdout.send('{"jsonrpc":"2.0","method":"ready"}\n')
    await launch

    expect(writes).toEqual(['{"jsonrpc":"2.0","method":"start","params":{"sessionID":"parent","rows":[{"callID":"call-1"}]}}\n'])
  })

  test("applies startup timeout default 20000", async () => {
    const stdout = createStdout()
    const timers = new ManualTimers()

    const launch = launchPickerProcess({
      timers,
      spawn() {
        return { stdout: stdout.stream, exited: new Promise<number>(() => {}) }
      },
    })

    expect(timers.delays).toEqual([20000])
    timers.fireAll()

    await expect(launch).resolves.toMatchObject({ kind: "technical_failure", reason: expect.stringContaining("timeout") })
  })

  test("treats missing binary as a technical failure", async () => {
    const result = await launchPickerProcess({
      spawn() {
        const error = new Error("not found") as Error & { code: string }
        error.code = "ENOENT"
        throw error
      },
    })

    expect(result).toMatchObject({ kind: "technical_failure", reason: expect.stringContaining("not found") })
  })

  test("treats crash before ready as a technical failure", async () => {
    const stdout = createStdout()
    const exited = deferred<number>()

    const launch = launchPickerProcess({
      spawn() {
        return { stdout: stdout.stream, exited: exited.promise }
      },
    })

    exited.resolve(1)

    await expect(launch).resolves.toMatchObject({ kind: "technical_failure", reason: expect.stringContaining("exited") })
  })

  test("treats invalid payload as a technical failure", async () => {
    const stdout = createStdout()

    const launch = launchPickerProcess({
      spawn() {
        return { stdout: stdout.stream, exited: new Promise<number>(() => {}) }
      },
    })

    stdout.send("{bad\n")

    await expect(launch).resolves.toMatchObject({ kind: "technical_failure", raw: "{bad" })
  })

  test("treats lost stdio after ready as a technical failure", async () => {
    const stdout = createStdout()

    const launch = launchPickerProcess({
      spawn() {
        return { stdout: stdout.stream, exited: new Promise<number>(() => {}) }
      },
    })
    stdout.send('{"jsonrpc":"2.0","method":"ready"}\n')

    const session = await launch
    if (session.kind !== "ready") throw new Error(session.reason)

    stdout.close()

    await expect(session.result).resolves.toMatchObject({ kind: "technical_failure", reason: expect.stringContaining("stdio") })
  })

  test("treats observed cancel as cancel even if the process exits afterward", async () => {
    const stdout = createStdout()
    const exited = deferred<number>()

    const launch = launchPickerProcess({
      spawn() {
        return { stdout: stdout.stream, exited: exited.promise }
      },
    })
    stdout.send('{"jsonrpc":"2.0","method":"ready"}\n')
    const session = await launch
    if (session.kind !== "ready") throw new Error(session.reason)

    stdout.send('{"jsonrpc":"2.0","method":"cancel"}\n')
    exited.resolve(1)

    await expect(session.result).resolves.toEqual({ kind: "cancel" })
  })

  test("keeps no active-window timeout after ready", async () => {
    const stdout = createStdout()
    const timers = new ManualTimers()

    const launch = launchPickerProcess({
      timers,
      spawn() {
        return { stdout: stdout.stream, exited: new Promise<number>(() => {}) }
      },
    })
    stdout.send('{"jsonrpc":"2.0","method":"ready"}\n')

    const session = await launch
    if (session.kind !== "ready") throw new Error(session.reason)
    expect(timers.activeCount()).toBe(0)

    timers.fireAll()
    expect(await isSettled(session.result)).toBe(false)

    stdout.send('{"jsonrpc":"2.0","method":"submit","params":{"selections":[]}}\n')
    await expect(session.result).resolves.toEqual({ kind: "submit", payload: { selections: [] } })
  })
})
