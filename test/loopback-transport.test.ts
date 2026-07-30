import { describe, expect, test } from "bun:test"

import {
  createLoopbackOnlyTransport,
  isLoopbackHttpUrl,
} from "../src/loopback-transport"

describe("loopback-only OpenCode transport", () => {
  test("accepts only credential-free HTTP loopback URLs", () => {
    expect(isLoopbackHttpUrl(new URL("http://127.0.0.1:4096"))).toBe(true)
    expect(isLoopbackHttpUrl(new URL("https://[::1]:4096"))).toBe(true)
    expect(isLoopbackHttpUrl(new URL("http://localhost:4096"))).toBe(true)
    expect(isLoopbackHttpUrl(new URL("http://user:secret@localhost:4096"))).toBe(false)
    expect(isLoopbackHttpUrl(new URL("https://example.com"))).toBe(false)
    expect(isLoopbackHttpUrl(new URL("file:///tmp/opencode.sock"))).toBe(false)
  })

  test("forces manual redirect handling on local requests", async () => {
    let received: Request | undefined
    const transport = createLoopbackOnlyTransport((async (request: Request) => {
      received = request
      return new Response(null, { status: 204 })
    }) as typeof fetch)

    await expect(transport("http://127.0.0.1:4096/session")).resolves.toHaveProperty(
      "status",
      204,
    )
    expect(received?.redirect).toBe("manual")
  })

  test("rejects non-loopback requests before using the underlying transport", async () => {
    let called = false
    const transport = createLoopbackOnlyTransport((async () => {
      called = true
      return new Response(null, { status: 204 })
    }) as typeof fetch)

    await expect(transport("https://example.com/session")).rejects.toThrow(
      "non-loopback",
    )
    expect(called).toBe(false)
  })

  test("rejects redirects instead of following them away from loopback", async () => {
    const transport = createLoopbackOnlyTransport((async () =>
      new Response(null, {
        status: 307,
        headers: { location: "https://example.com/capture" },
      })) as typeof fetch)

    await expect(transport("http://localhost:4096/session")).rejects.toThrow(
      "redirect",
    )
  })

  test("rejects a response reported as coming from outside loopback", async () => {
    const response = new Response(null, { status: 204 })
    Object.defineProperty(response, "url", {
      configurable: true,
      value: "https://example.com/session",
    })
    const transport = createLoopbackOnlyTransport(
      (async () => response) as typeof fetch,
    )

    await expect(transport("http://localhost:4096/session")).rejects.toThrow(
      "non-loopback",
    )
  })
})
