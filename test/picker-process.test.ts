import { describe, expect, test } from "bun:test"

import {
  launchPickerProcess,
  MAX_PICKER_RPC_LINE_BYTES,
  MAX_PICKER_STDERR_DIAGNOSTIC_CHARS,
  resolvePickerBinaryPath,
} from "../src/picker-process"

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
    expect(() => resolvePickerBinaryPath({
      env: { OPENCODE_MODEL_DISPATCH_PICKER: "./custom-picker" },
    })).toThrow(
      "OPENCODE_MODEL_DISPATCH_PICKER must be an absolute path to an operator-trusted binary",
    )
  })

  test("maps Node platform names to the packaged release asset names", () => {
    expect(resolvePickerBinaryPath({ binaryRoot: "/package/bin", platform: "linux", arch: "x64", env: {} })).toBe("/package/bin/picker-linux-x64")
    expect(resolvePickerBinaryPath({ binaryRoot: "/package/bin", platform: "linux", arch: "arm64", env: {} })).toBe("/package/bin/picker-linux-arm64")
    expect(resolvePickerBinaryPath({ binaryRoot: "/package/bin", platform: "darwin", arch: "arm64", env: {} })).toBe("/package/bin/picker-macos-arm64")
    expect(resolvePickerBinaryPath({ binaryRoot: "C:/package/bin", platform: "win32", arch: "x64", env: {} })).toContain("picker-windows-x64.exe")
    expect(resolvePickerBinaryPath({ binaryRoot: "C:/package/bin", platform: "win32", arch: "arm64", env: {} })).toContain("picker-windows-arm64.exe")
  })

  test("fails clearly on targets without a bundled picker while still allowing an explicit override", async () => {
    expect(() => resolvePickerBinaryPath({
      binaryRoot: "/package/bin",
      platform: "linux",
      arch: "ppc64",
      env: {},
    })).toThrow("Unsupported bundled picker target linux-ppc64")
    expect(resolvePickerBinaryPath({
      platform: "linux",
      arch: "ppc64",
      env: { OPENCODE_MODEL_DISPATCH_PICKER: "/custom/picker" },
    })).toBe("/custom/picker")

    await expect(launchPickerProcess({
      platform: "linux",
      arch: "ppc64",
      env: {},
    })).resolves.toMatchObject({
      kind: "technical_failure",
      reason: expect.stringContaining("Unsupported bundled picker target linux-ppc64"),
    })
  })

  test("sends the picker request after ready and waits for its started acknowledgement", async () => {
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
    await Promise.resolve()

    expect(writes).toEqual(['{"jsonrpc":"2.0","method":"start","params":{"sessionID":"parent","rows":[{"callID":"call-1"}]}}\n'])
    expect(await isSettled(launch)).toBe(false)

    stdout.send('{"jsonrpc":"2.0","method":"started"}\n')
    await expect(launch).resolves.toMatchObject({ kind: "ready" })
  })

  test("flushes Bun file-sink stdin after writing the start request", async () => {
    const stdout = createStdout()
    const calls: string[] = []
    const launch = launchPickerProcess({
      request: { sessionID: "parent" },
      spawn() {
        return {
          stdout: stdout.stream,
          stdin: {
            write() {
              calls.push("write")
            },
            flush() {
              calls.push("flush")
            },
          },
          exited: new Promise<number>(() => {}),
        }
      },
    })

    stdout.send('{"jsonrpc":"2.0","method":"ready"}\n')
    await Promise.resolve()
    await Promise.resolve()
    expect(calls).toEqual(["write", "flush"])
    expect(await isSettled(launch)).toBe(false)
    stdout.send('{"jsonrpc":"2.0","method":"started"}\n')
    await expect(launch).resolves.toMatchObject({ kind: "ready" })
  })

  test("turns a rejected start-request write into a technical failure", async () => {
    const stdout = createStdout()
    const launch = launchPickerProcess({
      request: { sessionID: "parent" },
      spawn() {
        return {
          stdout: stdout.stream,
          stdin: {
            write() {
              return Promise.reject(new Error("broken pipe"))
            },
          },
          exited: new Promise<number>(() => {}),
        }
      },
    })

    stdout.send('{"jsonrpc":"2.0","method":"ready"}\n')
    await expect(launch).resolves.toMatchObject({
      kind: "technical_failure",
      reason: expect.stringContaining("broken pipe"),
    })
  })

  test("rejects an oversized start request before writing and terminates the picker", async () => {
    const stdout = createStdout()
    let writes = 0
    let kills = 0
    const launch = launchPickerProcess({
      request: { catalog: "x".repeat(4 * 1024 * 1024) },
      spawn() {
        return {
          stdout: stdout.stream,
          stdin: {
            write() {
              writes++
              return Promise.reject(new Error("oversized write reached"))
            },
          },
          exited: new Promise<number>(() => {}),
          kill: () => {
            kills++
          },
        }
      },
    })

    stdout.send('{"jsonrpc":"2.0","method":"ready"}\n')
    await expect(launch).resolves.toMatchObject({
      kind: "technical_failure",
      reason: expect.stringContaining("exceeds 4194304 bytes"),
    })
    expect(writes).toBe(0)
    expect(kills).toBe(1)
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

  test("keeps the startup timeout active until the picker acknowledges the request", async () => {
    const stdout = createStdout()
    const timers = new ManualTimers()
    let kills = 0
    const launch = launchPickerProcess({
      request: { sessionID: "parent" },
      timers,
      spawn() {
        return {
          stdout: stdout.stream,
          stdin: { write: () => Promise.resolve() },
          exited: new Promise<number>(() => {}),
          kill: () => {
            kills++
          },
        }
      },
    })

    stdout.send('{"jsonrpc":"2.0","method":"ready"}\n')
    await Promise.resolve()
    await Promise.resolve()
    expect(timers.activeCount()).toBe(1)

    timers.fireAll()

    await expect(launch).resolves.toMatchObject({
      kind: "technical_failure",
      reason: expect.stringContaining("timeout"),
    })
    expect(kills).toBe(1)
  })

  test("includes bounded sanitized stderr when startup times out", async () => {
    const stdout = createStdout()
    const stderr = createStdout()
    const timers = new ManualTimers()
    const launch = launchPickerProcess({
      timers,
      spawn() {
        return {
          stdout: stdout.stream,
          stderr: stderr.stream,
          exited: new Promise<number>(() => {}),
        }
      },
    })

    stderr.send(
      `discarded-marker-${"x".repeat(MAX_PICKER_STDERR_DIAGNOSTIC_CHARS)}\r\nwebkit\u0000 initialization\u202e failed`,
    )
    await Promise.resolve()
    timers.fireAll()

    const failure = await launch
    expect(failure.kind).toBe("technical_failure")
    if (failure.kind !== "technical_failure") return
    expect(failure.reason).toContain("Picker startup timeout after 20000ms")
    expect(failure.reason).toContain("webkit initialization failed")
    expect(failure.reason).not.toContain("discarded-marker")
    expect(failure.raw).toContain("webkit initialization failed")
    expect(failure.raw?.length).toBeLessThanOrEqual(
      MAX_PICKER_STDERR_DIAGNOSTIC_CHARS,
    )
    expect(failure.raw).not.toMatch(/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u)
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

  test("drains and reports bounded picker stderr diagnostics", async () => {
    const stdout = createStdout()
    const stderr = createStdout()
    const exited = deferred<number>()
    const launch = launchPickerProcess({
      spawn() {
        return { stdout: stdout.stream, stderr: stderr.stream, exited: exited.promise }
      },
    })

    stderr.send("webkit initialization failed\n")
    await Promise.resolve()
    exited.resolve(1)

    await expect(launch).resolves.toMatchObject({
      kind: "technical_failure",
      raw: expect.stringContaining("webkit initialization failed"),
    })
  })

  test("treats invalid payload as a technical failure", async () => {
    const stdout = createStdout()
    let kills = 0

    const launch = launchPickerProcess({
      spawn() {
        return {
          stdout: stdout.stream,
          exited: new Promise<number>(() => {}),
          kill: () => {
            kills++
          },
        }
      },
    })

    stdout.send("{bad\n")

    await expect(launch).resolves.toMatchObject({ kind: "technical_failure", raw: "{bad" })
    expect(kills).toBe(1)
  })

  test("rejects an oversized newline-free stdout line and terminates the picker", async () => {
    const stdout = createStdout()
    let kills = 0
    const launch = launchPickerProcess({
      spawn() {
        return {
          stdout: stdout.stream,
          exited: new Promise<number>(() => {}),
          kill: () => {
            kills++
          },
        }
      },
    })

    stdout.send("x".repeat(MAX_PICKER_RPC_LINE_BYTES + 1))

    await expect(launch).resolves.toMatchObject({
      kind: "technical_failure",
      reason: expect.stringContaining(
        `exceeds ${MAX_PICKER_RPC_LINE_BYTES} bytes`,
      ),
    })
    expect(kills).toBe(1)
  })

  test("treats lost stdio after ready as a technical failure", async () => {
    const stdout = createStdout()
    let kills = 0

    const launch = launchPickerProcess({
      spawn() {
        return {
          stdout: stdout.stream,
          exited: new Promise<number>(() => {}),
          kill: () => {
            kills++
          },
        }
      },
    })
    stdout.send('{"jsonrpc":"2.0","method":"ready"}\n')

    const session = await launch
    if (session.kind !== "ready") throw new Error(session.reason)

    stdout.close()

    await expect(session.result).resolves.toMatchObject({ kind: "technical_failure", reason: expect.stringContaining("stdio") })
    expect(kills).toBe(1)
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

  test("terminates the native picker after receiving a terminal submit decision", async () => {
    const stdout = createStdout()
    let kills = 0
    const launch = launchPickerProcess({
      spawn() {
        return {
          stdout: stdout.stream,
          exited: new Promise<number>(() => {}),
          kill: () => {
            kills++
          },
        }
      },
    })
    stdout.send('{"jsonrpc":"2.0","method":"ready"}\n')
    const session = await launch
    if (session.kind !== "ready") throw new Error(session.reason)

    stdout.send('{"jsonrpc":"2.0","method":"submit","params":{"selections":[]}}\n')

    await expect(session.result).resolves.toEqual({ kind: "submit", payload: { selections: [] } })
    expect(kills).toBe(1)
  })

  test("replaces startup timeout with a bounded decision timeout after acknowledgement", async () => {
    const stdout = createStdout()
    const timers = new ManualTimers()

    const launch = launchPickerProcess({
      request: { sessionID: "parent" },
      timers,
      spawn() {
        return {
          stdout: stdout.stream,
          stdin: { write: () => Promise.resolve() },
          exited: new Promise<number>(() => {}),
        }
      },
    })
    stdout.send('{"jsonrpc":"2.0","method":"ready"}\n')
    await Promise.resolve()
    stdout.send('{"jsonrpc":"2.0","method":"started"}\n')

    const session = await launch
    if (session.kind !== "ready") throw new Error(session.reason)
    expect(timers.activeCount()).toBe(1)
    expect(timers.delays).toEqual([20000, 600000])

    timers.fireAll()
    await expect(session.result).resolves.toMatchObject({
      kind: "technical_failure",
      reason: "Picker decision timeout after 600000ms",
    })
    expect(timers.activeCount()).toBe(0)
  })
})
