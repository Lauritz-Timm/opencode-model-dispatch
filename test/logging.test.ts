import { describe, expect, test } from "bun:test"

import { DEFAULT_SETTINGS } from "../src/settings"
import { logDispatchFailure, logDispatchSuccess, MODEL_DISPATCH_CANCELLED, MODEL_DISPATCH_PICKER_FAILED, type PluginLogEntry } from "../src/logging"

describe("privacy-safe logging", () => {
  test("success logs include only non-sensitive telemetry", () => {
    const entries: PluginLogEntry[] = []

    const result = logDispatchSuccess(DEFAULT_SETTINGS, { info: (entry) => entries.push(entry), error: (entry) => entries.push(entry) }, {
      batchID: "batch-1",
      callIDs: ["call-1", "call-2"],
      sessionID: "session-1",
      platform: "win32",
      pickerVersion: "1.2.3",
      ipcStatus: "connected",
      processStatus: "running",
      selectedCount: 2,
      prompt: "secret prompt",
      description: "secret description",
      userText: "secret user text",
    } as never)

    expect(result).toEqual({ warnings: [] })
    expect(entries).toEqual([
      {
        event: "model_dispatch_success",
        batchID: "batch-1",
        callIDs: ["call-1", "call-2"],
        sessionID: "session-1",
        platform: "win32",
        pickerVersion: "1.2.3",
        ipcStatus: "connected",
        processStatus: "running",
        selectedCount: 2,
      },
    ])
    expect(JSON.stringify(entries)).not.toContain("secret")
  })

  test("failure logs include operational failure fields but no sensitive task text", () => {
    const entries: PluginLogEntry[] = []

    const result = logDispatchFailure(DEFAULT_SETTINGS, { info: (entry) => entries.push(entry), error: (entry) => entries.push(entry) }, {
      code: MODEL_DISPATCH_PICKER_FAILED,
      category: "technical_failure",
      batchID: "batch-1",
      callID: "call-1",
      sessionID: "session-1",
      platform: "win32",
      pickerVersion: "1.2.3",
      ipcStatus: "disconnected",
      processStatus: "exited",
      prompt: "secret prompt",
      description: "secret description",
      userText: "secret user text",
    } as never)

    expect(result).toEqual({ warnings: ["Model dispatch picker failed; using the configured fallback model."] })
    expect(entries).toEqual([
      {
        event: "model_dispatch_failure",
        code: MODEL_DISPATCH_PICKER_FAILED,
        category: "technical_failure",
        batchID: "batch-1",
        callID: "call-1",
        sessionID: "session-1",
        platform: "win32",
        pickerVersion: "1.2.3",
        ipcStatus: "disconnected",
        processStatus: "exited",
      },
    ])
    expect(JSON.stringify(entries)).not.toContain("secret")
  })

  test("disabled privacy logging suppresses plugin logs but still returns user-facing messages", () => {
    const entries: PluginLogEntry[] = []
    const settings = { ...DEFAULT_SETTINGS, privacy: { logging_enabled: false } }

    const cancelled = logDispatchFailure(settings, { info: (entry) => entries.push(entry), error: (entry) => entries.push(entry) }, {
      code: MODEL_DISPATCH_CANCELLED,
      category: "user_cancelled",
      batchID: "batch-1",
      callID: "call-1",
      sessionID: "session-1",
      platform: "win32",
      pickerVersion: "1.2.3",
      ipcStatus: "connected",
      processStatus: "running",
    })
    const pickerFailed = logDispatchFailure(settings, { info: (entry) => entries.push(entry), error: (entry) => entries.push(entry) }, {
      code: MODEL_DISPATCH_PICKER_FAILED,
      category: "technical_failure",
      batchID: "batch-2",
      callID: "call-2",
      sessionID: "session-2",
      platform: "win32",
      pickerVersion: "1.2.3",
      ipcStatus: "disconnected",
      processStatus: "exited",
    })

    expect(entries).toEqual([])
    expect(cancelled).toEqual({ errors: ["Model selection cancelled"] })
    expect(pickerFailed).toEqual({ warnings: ["Model dispatch picker failed; using the configured fallback model."] })
  })
})
