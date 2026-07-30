import { describe, expect, test } from "bun:test"

import { parseJsonRpcMessage } from "../src/picker-rpc"
import {
  MAX_PICKER_ID_LENGTH,
  MAX_PICKER_MODELS_PER_PROVIDER,
  MAX_PICKER_NAME_LENGTH,
  MAX_PICKER_PROVIDERS_PER_CATALOG,
  MAX_PICKER_RPC_LINE_BYTES,
  MAX_PICKER_TASKS,
  MAX_PICKER_VARIANTS_PER_MODEL,
} from "../picker/src/runtime-limits"
import { createPickerRuntimeAdapter, pickerRuntimeRequestFromLine, type RuntimeEventHandler } from "../picker/src/runtime-rpc"

describe("picker runtime smoke", () => {
  test("adapter emits ready, hydrates one start request, then acknowledges it", async () => {
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
              models: [{ providerID: "openai", providerName: "OpenAI", modelID: "gpt-4.1", modelName: "GPT-4.1", variants: ["fast", "deep-reasoning"] }],
            },
          ],
          applyToAllCatalog: [],
          rows: [{
            callID: "call-1",
            agentName: "builder",
            preselect: {
              providerID: "openai",
              providerName: "OpenAI",
              modelID: "gpt-4.1",
              modelName: "GPT-4.1",
              variants: ["fast", "deep-reasoning"],
              variant: "deep-reasoning",
              hidden: false,
              source: "agent",
            },
          }],
          theme: { themeID: "nightowl", colorScheme: "dark" },
        },
      }),
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(starts).toEqual([
      {
        theme: { themeID: "nightowl", colorScheme: "dark" },
        modelSelection: {
          tasks: [{ id: "call-1", agentType: "builder", description: "" }],
          models: [{ providerID: "openai", providerName: "OpenAI", modelID: "gpt-4.1", displayName: "GPT-4.1", variants: ["fast", "deep-reasoning"] }],
          applyToAllModels: [],
          preselectedModels: {
            "call-1": { providerID: "openai", modelID: "gpt-4.1", variant: "deep-reasoning" },
          },
        },
      },
    ])
    expect(written).toEqual([
      '{"jsonrpc":"2.0","method":"ready"}',
      '{"jsonrpc":"2.0","method":"started"}',
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

    await adapter.submit({ selections: [{ taskID: "call-1", providerID: "openai", modelID: "gpt-4.1", variant: "deep-reasoning" }] })
    await adapter.cancel()

    expect(written).toEqual([
      '{"jsonrpc":"2.0","method":"submit","params":{"selections":[{"taskID":"call-1","providerID":"openai","modelID":"gpt-4.1","variant":"deep-reasoning"}]}}',
      '{"jsonrpc":"2.0","method":"cancel"}',
    ])
    expect(written.map((line) => parseJsonRpcMessage(line))).toEqual([
      { jsonrpc: "2.0", method: "submit", params: { selections: [{ taskID: "call-1", providerID: "openai", modelID: "gpt-4.1", variant: "deep-reasoning" }] } },
      { jsonrpc: "2.0", method: "cancel" },
    ])
  })

  test("start line parsing accepts setup and theme-only backend payloads", () => {
    expect(pickerRuntimeRequestFromLine('{"jsonrpc":"2.0","method":"ready"}')).toBeUndefined()
    expect(pickerRuntimeRequestFromLine("not json")).toBeUndefined()
    expect(pickerRuntimeRequestFromLine('{"jsonrpc":"2.0","method":"start","params":{"theme":{"colorScheme":"light"}}}')).toEqual({
      theme: { colorScheme: "light" },
    })

    expect(pickerRuntimeRequestFromLine('{"jsonrpc":"2.0","method":"start","params":{"settings":{"dispatch":{"enabled":true}},"scope":"project","projectIsGitRepo":true}}')).toEqual({
      setup: { settings: { dispatch: { enabled: true } }, scope: "project", projectIsGitRepo: true },
    })
  })

  test("rejects an oversized start line before parsing it", () => {
    const line = JSON.stringify({
      jsonrpc: "2.0",
      method: "start",
      params: { theme: { themeID: "x".repeat(MAX_PICKER_RPC_LINE_BYTES) } },
    })

    expect(new TextEncoder().encode(line).byteLength).toBeGreaterThan(MAX_PICKER_RPC_LINE_BYTES)
    expect(pickerRuntimeRequestFromLine(line)).toBeUndefined()
  })

  test("rejects oversized task, provider, model, variant, and string fields instead of truncating them", () => {
    const model = {
      providerID: "openai",
      providerName: "OpenAI",
      modelID: "gpt-4.1",
      modelName: "GPT-4.1",
      variants: ["high"],
    }
    const provider = {
      providerID: "openai",
      providerName: "OpenAI",
      models: [model],
    }
    const row = { callID: "call-1", agentName: "builder" }
    const line = (params: Record<string, unknown>) => JSON.stringify({
      jsonrpc: "2.0",
      method: "start",
      params: {
        catalog: [provider],
        applyToAllCatalog: [],
        rows: [row],
        theme: { colorScheme: "dark" },
        ...params,
      },
    })

    const invalidRequests = [
      line({ rows: Array.from({ length: MAX_PICKER_TASKS + 1 }, (_, index) => ({ callID: `call-${index}` })) }),
      line({ catalog: Array.from({ length: MAX_PICKER_PROVIDERS_PER_CATALOG + 1 }, (_, index) => ({ providerID: `p-${index}`, providerName: "Provider", models: [] })) }),
      line({ catalog: [{ ...provider, models: Array.from({ length: MAX_PICKER_MODELS_PER_PROVIDER + 1 }, () => model) }] }),
      line({ catalog: [{ ...provider, models: [{ ...model, variants: Array.from({ length: MAX_PICKER_VARIANTS_PER_MODEL + 1 }, () => "high") }] }] }),
      line({ catalog: [{ ...provider, models: [{ ...model, modelName: "x".repeat(MAX_PICKER_NAME_LENGTH + 1) }] }] }),
      line({ rows: [{ ...row, callID: "x".repeat(MAX_PICKER_ID_LENGTH + 1) }] }),
    ]

    for (const request of invalidRequests) {
      expect(pickerRuntimeRequestFromLine(request)).toBeUndefined()
    }
  })
})
