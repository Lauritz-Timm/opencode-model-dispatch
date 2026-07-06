import { describe, expect, test } from "bun:test"

import { parseJsonRpcMessage } from "../src/picker-rpc"
import { createPickerRuntimeAdapter, pickerRuntimeRequestFromLine, type RuntimeEventHandler } from "../picker/src/runtime-rpc"

describe("picker runtime smoke", () => {
  test("adapter subscribes to runtime stdin events, emits ready, and parses backend start payloads", async () => {
    let subscribedEvent: string | undefined
    let handler: RuntimeEventHandler | undefined
    let unlistenCalled = false
    const written: string[] = []
    const adapter = createPickerRuntimeAdapter({
      listen: async (event, nextHandler) => {
        subscribedEvent = event
        handler = nextHandler
        return () => {
          unlistenCalled = true
        }
      },
      writeStdoutLine: async (line) => written.push(line),
    })
    const starts: unknown[] = []

    const stop = await adapter.start((request) => starts.push(request))

    expect(subscribedEvent).toBe("picker-rpc-message")
    expect(written).toEqual(['{"jsonrpc":"2.0","method":"ready"}'])
    expect(parseJsonRpcMessage(written[0]!)).toEqual({ jsonrpc: "2.0", method: "ready" })

    handler?.({ payload: "not json" })
    handler?.({ payload: '{"jsonrpc":"2.0","method":"submit"}' })
    handler?.({
      payload: JSON.stringify({
        jsonrpc: "2.0",
        method: "start",
        params: {
          catalog: [
            {
              providerID: "openai",
              providerName: "OpenAI",
              models: [{ providerID: "openai", providerName: "OpenAI", modelID: "gpt-4.1", modelName: "GPT-4.1" }],
            },
          ],
          applyToAllCatalog: [],
          rows: [{ callID: "call-1", agentName: "builder" }],
          theme: { themeID: "nightowl", colorScheme: "dark" },
        },
      }),
    })

    expect(starts).toEqual([
      {
        theme: { themeID: "nightowl", colorScheme: "dark" },
        modelSelection: {
          tasks: [{ id: "call-1", agentType: "builder", description: "builder" }],
          models: [{ providerID: "openai", providerName: "OpenAI", modelID: "gpt-4.1", displayName: "GPT-4.1" }],
          applyToAllModels: [],
          preselectedModels: {},
        },
      },
    ])

    stop()
    expect(unlistenCalled).toBe(true)
  })

  test("adapter emits backend-compatible submit and cancel stdout lines", async () => {
    const written: string[] = []
    const adapter = createPickerRuntimeAdapter({
      listen: async () => () => undefined,
      writeStdoutLine: async (line) => written.push(line),
    })

    await adapter.submit({ selections: [{ taskID: "call-1", providerID: "openai", modelID: "gpt-4.1" }] })
    await adapter.cancel()

    expect(written).toEqual([
      '{"jsonrpc":"2.0","method":"submit","params":{"selections":[{"taskID":"call-1","providerID":"openai","modelID":"gpt-4.1"}]}}',
      '{"jsonrpc":"2.0","method":"cancel"}',
    ])
    expect(written.map((line) => parseJsonRpcMessage(line))).toEqual([
      { jsonrpc: "2.0", method: "submit", params: { selections: [{ taskID: "call-1", providerID: "openai", modelID: "gpt-4.1" }] } },
      { jsonrpc: "2.0", method: "cancel" },
    ])
  })

  test("start line parsing accepts setup and theme-only backend payloads", () => {
    expect(pickerRuntimeRequestFromLine('{"jsonrpc":"2.0","method":"ready"}')).toBeUndefined()
    expect(pickerRuntimeRequestFromLine("not json")).toBeUndefined()
    expect(pickerRuntimeRequestFromLine('{"jsonrpc":"2.0","method":"start","params":{"theme":{"colorScheme":"light"}}}')).toEqual({
      theme: { colorScheme: "light" },
    })

    expect(pickerRuntimeRequestFromLine('{"jsonrpc":"2.0","method":"start","params":{"settings":{"dispatch":{"enabled":true}},"scope":"global"}}')).toEqual({
      setup: { settings: { dispatch: { enabled: true } }, scope: "global" },
    })
  })
})
