import { describe, expect, test } from "bun:test"

import {
  applyModelSelectionAction,
  createModelSelectionState,
  filteredModelGroups,
  modelSelectionSubmitDisabled,
  type ModelSelectionState,
} from "../picker/src/model-selection-reducer"
import {
  applySetupAction,
  createSetupState,
  defaultSetupSettings,
  setupSubmitDisabled,
} from "../picker/src/setup-reducer"
import {
  createPickerContractFixture,
  decodeNdjson,
  encodeJsonRpc,
} from "../picker/src/protocol"

const models = [
  { providerID: "anthropic", providerName: "Anthropic", modelID: "claude-sonnet-4", displayName: "Claude Sonnet 4" },
  { providerID: "anthropic", providerName: "Anthropic", modelID: "claude-opus-4", displayName: "Claude Opus 4" },
  { providerID: "openai", providerName: "OpenAI", modelID: "gpt-4.1", displayName: "GPT-4.1" },
]

const tasks = [
  { id: "task-a", agentType: "investigator", description: "Find the protocol implementation without showing prompts." },
  { id: "task-b", agentType: "builder", description: "Patch the reducer and keep the edit minimal." },
]

function modelState(): ModelSelectionState {
  return createModelSelectionState({ tasks, models })
}

describe("picker model selection reducer", () => {
  test("starts with apply-to-all before task rows and keeps prompts out of row data", () => {
    const state = modelState()

    expect(state.rowOrder).toEqual(["apply-to-all", "task-a", "task-b"])
    expect(state.rows).toEqual([
      { id: "task-a", agentType: "investigator", description: "Find the protocol implementation without showing prompts.", expanded: false },
      { id: "task-b", agentType: "builder", description: "Patch the reducer and keep the edit minimal.", expanded: false },
    ])
    expect(state.rows.every((row) => !("prompt" in row))).toBe(true)
  })

  test("apply-to-all assigns one model to every task and keeps focus on apply-to-all", () => {
    const state = applyModelSelectionAction(modelState(), {
      type: "selectModel",
      target: "apply-to-all",
      model: { providerID: "anthropic", modelID: "claude-sonnet-4" },
    })

    expect(state.applyToAllModel).toEqual({ providerID: "anthropic", modelID: "claude-sonnet-4" })
    expect(state.selections).toEqual({
      "task-a": { providerID: "anthropic", modelID: "claude-sonnet-4" },
      "task-b": { providerID: "anthropic", modelID: "claude-sonnet-4" },
    })
    expect(state.focus).toBe("apply-to-all")
  })

  test("dropdown search preserves provider groups and filters by model text", () => {
    const searched = applyModelSelectionAction(
      applyModelSelectionAction(modelState(), { type: "openDropdown", target: "task-a" }),
      { type: "setSearch", value: "opus" },
    )

    expect(searched.dropdown).toEqual({ openFor: "task-a", search: "opus" })
    expect(filteredModelGroups(searched)).toEqual([
      {
        providerID: "anthropic",
        providerName: "Anthropic",
        models: [{ providerID: "anthropic", providerName: "Anthropic", modelID: "claude-opus-4", displayName: "Claude Opus 4" }],
      },
    ])
  })

  test("validation errors mark invalid rows and disable submit", () => {
    const invalid = applyModelSelectionAction(modelState(), {
      type: "validationResult",
      errors: { "task-b": "Model is no longer available" },
    })

    expect(invalid.validationErrors).toEqual({ "task-b": "Model is no longer available" })
    expect(modelSelectionSubmitDisabled(invalid)).toBe(true)

    const selected = applyModelSelectionAction(modelState(), {
      type: "selectModel",
      target: "apply-to-all",
      model: { providerID: "openai", modelID: "gpt-4.1" },
    })
    expect(modelSelectionSubmitDisabled(selected)).toBe(false)
  })

  test("keyboard commands cover submit, cancel, dropdown close, expand, and arrows", () => {
    const ready = applyModelSelectionAction(modelState(), {
      type: "selectModel",
      target: "apply-to-all",
      model: { providerID: "openai", modelID: "gpt-4.1" },
    })
    expect(applyModelSelectionAction(ready, { type: "key", key: "Enter" }).commands.at(-1)).toEqual({ type: "submit" })
    expect(applyModelSelectionAction(ready, { type: "key", key: "Escape" }).commands.at(-1)).toEqual({ type: "cancel" })

    const rowFocused = applyModelSelectionAction(ready, { type: "key", key: "ArrowDown" })
    expect(rowFocused.focus).toBe("task-a")
    expect(applyModelSelectionAction(rowFocused, { type: "key", key: "Enter", shift: true }).rows[0]?.expanded).toBe(true)

    const dropdown = applyModelSelectionAction(rowFocused, { type: "openDropdown", target: "task-a" })
    expect(applyModelSelectionAction(dropdown, { type: "key", key: "Escape", shift: true }).dropdown.openFor).toBeUndefined()
    expect(applyModelSelectionAction(rowFocused, { type: "key", key: "ArrowUp" }).focus).toBe("apply-to-all")
  })
})

describe("picker setup/config reducer", () => {
  test("validates settings, changes scope, and documents global-only privacy logging", () => {
    const scoped = applySetupAction(createSetupState(), { type: "setScope", scope: "project", projectIsGitRepo: true })
    const invalid = applySetupAction(scoped, { type: "setDispatch", field: "batchMs", value: 0 })

    expect(scoped.scope).toBe("project")
    expect(scoped.projectGitignore).toEqual({ offer: true, addModelDispatchConfig: true, warning: "Project settings can be committed if not ignored." })
    expect(invalid.validationErrors.batchMs).toBe("Batch window must be greater than 0 ms")
    expect(setupSubmitDisabled(invalid)).toBe(true)
    expect(scoped.privacyNotice).toContain("Privacy/logging is always written globally")
  })

  test("setup mode only emits backend-supported technical failure mode", () => {
    const state = createSetupState()

    expect(state.settings.dispatch.technicalFailure).toBe("default_model")
    expect(JSON.stringify(state)).not.toContain("cancel")
  })

  test("cancel and snooze disable dispatch and emit setup commands", () => {
    const cancelled = applySetupAction(createSetupState({ now: 1000 }), { type: "cancel" })
    const snoozed = applySetupAction(createSetupState({ now: 1000 }), { type: "snooze" })

    expect(cancelled.settings.dispatch.enabled).toBe(false)
    expect(cancelled.commands.at(-1)).toEqual({ type: "cancel", snoozedUntil: 86_401_000 })
    expect(snoozed.commands.at(-1)).toEqual({ type: "snooze", snoozedUntil: 86_401_000 })
  })

  test("reset restores v1 defaults", () => {
    const changed = applySetupAction(createSetupState(), { type: "setPrivacyLogging", enabled: false })

    expect(changed.settings.privacy.loggingEnabled).toBe(false)
    expect(applySetupAction(changed, { type: "reset" }).settings).toEqual(defaultSetupSettings())
  })
})

describe("picker protocol contract fixture", () => {
  test("exchanges picker selection NDJSON JSON-RPC with the plugin harness shape", () => {
    const fixture = createPickerContractFixture()

    fixture.fromPlugin(encodeJsonRpc({ jsonrpc: "2.0", id: "open", method: "open", params: { mode: "model-selection", tasks, models } }))
    fixture.fromPicker(encodeJsonRpc({ jsonrpc: "2.0", method: "ready", params: { mode: "model-selection" } }))
    fixture.fromPicker(encodeJsonRpc({ jsonrpc: "2.0", method: "submit", params: { selections: [{ taskID: "task-a", providerID: "openai", modelID: "gpt-4.1" }] } }))

    expect(fixture.pluginMessages).toEqual([
      { jsonrpc: "2.0", method: "ready", params: { mode: "model-selection" } },
      { jsonrpc: "2.0", method: "submit", params: { selections: [{ taskID: "task-a", providerID: "openai", modelID: "gpt-4.1" }] } },
    ])
    expect(fixture.pickerMessages[0]).toMatchObject({ jsonrpc: "2.0", id: "open", method: "open" })
  })

  test("exchanges setup/config NDJSON JSON-RPC without importing root protocol code", () => {
    const fixture = createPickerContractFixture()
    const settings = defaultSetupSettings()

    fixture.fromPlugin(encodeJsonRpc({ jsonrpc: "2.0", id: 1, method: "open", params: { mode: "setup", settings } }))
    fixture.fromPicker(encodeJsonRpc({ jsonrpc: "2.0", method: "submit", params: { mode: "setup", scope: "global", settings } }))

    expect(decodeNdjson(fixture.pluginOut).at(-1)).toEqual({ jsonrpc: "2.0", method: "submit", params: { mode: "setup", scope: "global", settings } })
    expect(decodeNdjson(fixture.pickerOut).at(-1)).toEqual({ jsonrpc: "2.0", id: 1, method: "open", params: { mode: "setup", settings } })
  })
})
