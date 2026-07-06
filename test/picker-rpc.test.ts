import { describe, expect, test } from "bun:test"

import {
  JsonRpcMatcher,
  decodeNdjsonChunk,
  encodeJsonRpcMessage,
  parseJsonRpcMessage,
  technicalFailureFromParseError,
} from "../src/picker-rpc"

describe("picker JSON-RPC protocol", () => {
  test("encodes and decodes NDJSON JSON-RPC messages", () => {
    const message = { jsonrpc: "2.0" as const, id: "1", method: "ready", params: { ok: true } }

    const encoded = encodeJsonRpcMessage(message)

    expect(encoded.endsWith("\n")).toBe(true)
    expect(parseJsonRpcMessage(encoded.trim())).toEqual(message)
  })

  test("decodes chunks and leaves incomplete lines buffered", () => {
    const decoder = decodeNdjsonChunk()

    const first = decoder.push('{"jsonrpc":"2.0","method":"ready"}\n{"jsonrpc"')
    const second = decoder.push(':"2.0","method":"cancel"}\n')

    expect(first.messages.map((message) => message.method)).toEqual(["ready"])
    expect(first.buffer).toBe('{"jsonrpc"')
    expect(second.messages.map((message) => message.method)).toEqual(["cancel"])
    expect(second.buffer).toBe("")
  })

  test("matches responses by id", () => {
    const matcher = new JsonRpcMatcher()
    matcher.register("a")
    matcher.register("b")

    expect(matcher.resolve({ jsonrpc: "2.0", id: "b", result: 2 })).toEqual({ jsonrpc: "2.0", id: "b", result: 2 })
    expect(matcher.resolve({ jsonrpc: "2.0", id: "missing", result: 1 })).toBeUndefined()
    expect(matcher.pendingIds()).toEqual(["a"])
  })

  test("turns parse errors into technical failures with debug reasons", () => {
    const failure = technicalFailureFromParseError("{bad", new Error("Unexpected token"))

    expect(failure.kind).toBe("technical_failure")
    expect(failure.reason).toContain("Unexpected token")
    expect(failure.raw).toBe("{bad")
  })

  test("accepts the reserved protocol methods", () => {
    for (const method of ["ready", "validateModel", "refreshModels", "submit", "cancel", "log", "resize", "themeChanged", "focusChanged"]) {
      expect(parseJsonRpcMessage(JSON.stringify({ jsonrpc: "2.0", method }))).toEqual({ jsonrpc: "2.0", method })
    }
  })
})
