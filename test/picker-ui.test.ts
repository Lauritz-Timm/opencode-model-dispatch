import { describe, expect, test } from "bun:test"

import {
  APPLY_TO_ALL_TARGET,
  applyModelSelectionAction,
  buildModelSelectionSubmitParams,
  createModelSelectionState,
  filteredModelGroups,
  modelRefForValue,
  modelRefValue,
  modelSelectionSubmitDisabled,
  modelsForSelectionTarget,
  shouldSubmitModelSelectionFromKeyboard,
  taskSelectionTarget,
  variantsForSelectionTarget,
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
import { formatEffortVariantLabel, normalizeEffortVariants } from "../picker/src/effort"
import {
  escapeModelIdentifier,
  formatModelAccessibleLabel,
  formatModelIdentity,
} from "../picker/src/model-identity"
import { cssVariables, themeTokens } from "../picker/src/theme"
import { resolveOpenCodeThemeCss } from "../picker/src/opencode-theme-resolver"
import { modelSelectionInputFromPickerRequest, modelsForTaskRow, resolvePickerRuntimeData, resolvePickerThemeHint } from "../picker/src/runtime-request"
import { createPickerRuntimeAdapter, pickerRuntimeRequestFromLine } from "../picker/src/runtime-rpc"
import { nativePickerSmokeRequest } from "../scripts/picker-smoke-fixture"

const models = [
  { providerID: "anthropic", providerName: "Anthropic", modelID: "claude-sonnet-4", displayName: "Claude Sonnet 4", variants: ["quick", "deep-reasoning"] },
  { providerID: "anthropic", providerName: "Anthropic", modelID: "claude-opus-4", displayName: "Claude Opus 4", variants: ["deep-reasoning"] },
  { providerID: "openai", providerName: "OpenAI", modelID: "gpt-4.1", displayName: "GPT-4.1", variants: [] },
]

const tasks = [
  { id: "task-a", agentType: "investigator", description: "Find the protocol implementation without showing prompts." },
  { id: "task-b", agentType: "builder", description: "Patch the reducer and keep the edit minimal." },
]

function modelState(): ModelSelectionState {
  return createModelSelectionState({ tasks, models })
}

describe("picker model identity display", () => {
  test("renders Unicode identifiers canonically without colliding with literal escapes", () => {
    expect(escapeModelIdentifier("openai")).toBe("openai")
    expect(escapeModelIdentifier("\u043epenai")).toBe("\\u{43E}penai")
    expect(escapeModelIdentifier("\\u{43E}penai")).toBe(
      "\\\\u{43E}penai",
    )
    expect(formatModelIdentity({
      providerID: "\u043epenai",
      modelID: "gpt-5",
    })).toBe("\\u{43E}penai · gpt-5")
    expect(formatModelAccessibleLabel({
      providerID: "\u043epenai",
      modelID: "gpt-5",
      displayName: "GPT-5",
    })).toBe(
      "GPT-5, provider ID \\u{43E}penai, model ID gpt-5",
    )
  })
})

describe("picker model selection reducer", () => {
  test("native smoke exposes its shared catalog through Apply to all", () => {
    const input = modelSelectionInputFromPickerRequest(
      nativePickerSmokeRequest,
    )
    const state = createModelSelectionState(input)

    expect(
      modelsForSelectionTarget(state, APPLY_TO_ALL_TARGET).map((model) =>
        model.modelID
      ),
    ).toEqual(["gpt-5", "gpt-5-mini"])
  })

  test("starts with apply-to-all before task rows and keeps prompts out of row data", () => {
    const state = modelState()

    expect(state.rowOrder).toEqual([
      APPLY_TO_ALL_TARGET,
      taskSelectionTarget("task-a"),
      taskSelectionTarget("task-b"),
    ])
    expect(state.rows).toEqual([
      { id: "task-a", agentType: "investigator", description: "Find the protocol implementation without showing prompts.", expanded: false },
      { id: "task-b", agentType: "builder", description: "Patch the reducer and keep the edit minimal.", expanded: false },
    ])
    expect(state.rows.every((row) => !("prompt" in row))).toBe(true)
  })

  test("apply-to-all assigns one model to every task and keeps focus on apply-to-all", () => {
    const state = applyModelSelectionAction(modelState(), {
      type: "selectModel",
      target: APPLY_TO_ALL_TARGET,
      model: { providerID: "anthropic", modelID: "claude-sonnet-4" },
    })

    expect(state.applyToAllModel).toEqual({ providerID: "anthropic", modelID: "claude-sonnet-4" })
    expect(state.selections).toEqual({
      "task-a": { providerID: "anthropic", modelID: "claude-sonnet-4" },
      "task-b": { providerID: "anthropic", modelID: "claude-sonnet-4" },
    })
    expect(state.focus).toBe(APPLY_TO_ALL_TARGET)
  })

  test("effort defaults back to Auto when the selected model changes", () => {
    const selected = applyModelSelectionAction(
      applyModelSelectionAction(modelState(), {
        type: "selectModel",
        target: APPLY_TO_ALL_TARGET,
        model: { providerID: "anthropic", modelID: "claude-sonnet-4" },
      }),
      {
        type: "selectVariant",
        target: APPLY_TO_ALL_TARGET,
        variant: "deep-reasoning",
      },
    )
    const preservedForSameModel = applyModelSelectionAction(selected, {
      type: "selectModel",
      target: taskSelectionTarget("task-b"),
      model: { providerID: "anthropic", modelID: "claude-sonnet-4" },
    })
    const resetForChangedModel = applyModelSelectionAction(preservedForSameModel, {
      type: "selectModel",
      target: taskSelectionTarget("task-b"),
      model: { providerID: "anthropic", modelID: "claude-opus-4" },
    })

    expect(preservedForSameModel.selections["task-b"]).toEqual({
      providerID: "anthropic",
      modelID: "claude-sonnet-4",
      variant: "deep-reasoning",
    })
    expect(resetForChangedModel.selections["task-b"]).toEqual({
      providerID: "anthropic",
      modelID: "claude-opus-4",
    })
    expect(formatEffortVariantLabel("deep-reasoning")).toBe("Deep Reasoning")
    expect(formatEffortVariantLabel("ULTRA_FAST")).toBe("Ultra Fast")
    expect(normalizeEffortVariants(["quick", "quick", "deep-reasoning"])).toEqual(["quick", "deep-reasoning"])
  })

  test("selectModel retains an explicitly supplied supported variant", () => {
    const explicit = applyModelSelectionAction(modelState(), {
      type: "selectModel",
      target: taskSelectionTarget("task-a"),
      model: {
        providerID: "anthropic",
        modelID: "claude-sonnet-4",
        variant: "quick",
      },
    })
    const unsupported = applyModelSelectionAction(explicit, {
      type: "selectModel",
      target: taskSelectionTarget("task-a"),
      model: {
        providerID: "anthropic",
        modelID: "claude-sonnet-4",
        variant: "provider-unknown",
      },
    })

    expect(explicit.selections["task-a"]).toEqual({
      providerID: "anthropic",
      modelID: "claude-sonnet-4",
      variant: "quick",
    })
    expect(unsupported.selections["task-a"]).toEqual({
      providerID: "anthropic",
      modelID: "claude-sonnet-4",
    })
  })

  test("unknown model refs are rejected and cannot make a batch submittable", () => {
    const unknownPreselection = createModelSelectionState({
      tasks,
      models,
      preselectedModels: {
        "task-a": { providerID: "missing", modelID: "ghost" },
        "task-b": { providerID: "missing", modelID: "ghost" },
      },
    })
    const valid = applyModelSelectionAction(modelState(), {
      type: "selectModel",
      target: APPLY_TO_ALL_TARGET,
      model: { providerID: "openai", modelID: "gpt-4.1" },
    })
    const rejected = applyModelSelectionAction(valid, {
      type: "selectModel",
      target: taskSelectionTarget("task-a"),
      model: { providerID: "missing", modelID: "ghost" },
    })

    expect(unknownPreselection.selections).toEqual({})
    expect(modelSelectionSubmitDisabled(unknownPreselection)).toBe(true)
    expect(rejected.selections["task-a"]).toBeUndefined()
    expect(modelSelectionSubmitDisabled(rejected)).toBe(true)
    expect(() => buildModelSelectionSubmitParams(rejected)).toThrow(
      "Cannot submit model selection while one or more rows are invalid",
    )
  })

  test("keeps provider and model IDs unambiguous when either contains slashes", () => {
    const attacker = {
      providerID: "openrouter/vendor",
      providerName: "Attacker",
      modelID: "model",
      displayName: "Attacker model",
      variants: [],
    }
    const intended = {
      providerID: "openrouter",
      providerName: "OpenRouter",
      modelID: "vendor/model",
      displayName: "Intended model",
      variants: [],
    }
    const state = createModelSelectionState({
      tasks: [tasks[0]!],
      models: [attacker, intended],
    })

    expect(modelRefValue(attacker)).not.toBe(modelRefValue(intended))
    expect(
      modelRefForValue(
        state,
        taskSelectionTarget("task-a"),
        modelRefValue(intended),
      ),
    ).toEqual({
      providerID: intended.providerID,
      modelID: intended.modelID,
    })
  })

  test("keeps a task named apply-to-all separate from the batch control", () => {
    const collisionTasks = [
      {
        id: "apply-to-all",
        agentType: "special",
        description: "",
      },
      {
        id: "victim",
        agentType: "general",
        description: "",
      },
    ]
    const selectedForAll = applyModelSelectionAction(
      createModelSelectionState({ tasks: collisionTasks, models }),
      {
        type: "selectModel",
        target: APPLY_TO_ALL_TARGET,
        model: {
          providerID: "anthropic",
          modelID: "claude-sonnet-4",
        },
      },
    )
    const selectedForOne = applyModelSelectionAction(selectedForAll, {
      type: "selectModel",
      target: taskSelectionTarget("apply-to-all"),
      model: {
        providerID: "openai",
        modelID: "gpt-4.1",
      },
    })

    expect(selectedForOne.selections).toEqual({
      "apply-to-all": {
        providerID: "openai",
        modelID: "gpt-4.1",
      },
      victim: {
        providerID: "anthropic",
        modelID: "claude-sonnet-4",
      },
    })
  })

  test("hidden row-only preselection and effort survive pure-state hydration", () => {
    const hiddenModel = {
      providerID: "openai",
      providerName: "OpenAI",
      modelID: "configured-hidden",
      displayName: "Configured hidden",
      variants: ["deep-reasoning"],
    }
    const state = createModelSelectionState({
      tasks,
      models,
      rowOnlyModels: { "task-a": [hiddenModel] },
      preselectedModels: {
        "task-a": {
          providerID: "openai",
          modelID: "configured-hidden",
          variant: "deep-reasoning",
        },
        "task-b": { providerID: "openai", modelID: "gpt-4.1" },
      },
    })
    const wrongRow = applyModelSelectionAction(state, {
      type: "selectModel",
      target: taskSelectionTarget("task-b"),
      model: {
        providerID: "openai",
        modelID: "configured-hidden",
        variant: "deep-reasoning",
      },
    })

    expect(state.selections["task-a"]).toEqual({
      providerID: "openai",
      modelID: "configured-hidden",
      variant: "deep-reasoning",
    })
    expect(
      variantsForSelectionTarget(state, taskSelectionTarget("task-a")),
    ).toEqual(["deep-reasoning"])
    expect(modelSelectionSubmitDisabled(state)).toBe(false)
    expect(buildModelSelectionSubmitParams(state).selections[0]).toEqual({
      taskID: "task-a",
      providerID: "openai",
      modelID: "configured-hidden",
      variant: "deep-reasoning",
    })
    expect(wrongRow.selections["task-b"]).toBeUndefined()
    expect(modelSelectionSubmitDisabled(wrongRow)).toBe(true)
  })

  test("row-only metadata overrides the common model for that row", () => {
    const state = createModelSelectionState({
      tasks,
      models,
      rowOnlyModels: {
        "task-a": [{
          ...models[0]!,
          variants: ["row-specific"],
        }],
      },
      preselectedModels: {
        "task-a": {
          providerID: "anthropic",
          modelID: "claude-sonnet-4",
          variant: "row-specific",
        },
      },
    })

    expect(
      variantsForSelectionTarget(state, taskSelectionTarget("task-a")),
    ).toEqual(["row-specific"])
    expect(state.selections["task-a"]?.variant).toBe("row-specific")
    expect(state.modelsByRow["task-b"]?.[0]?.variants).toEqual(["quick", "deep-reasoning"])
  })

  test("apply-to-all effort applies only to rows whose selected model advertises it", () => {
    const selected = applyModelSelectionAction(modelState(), {
      type: "selectModel",
      target: APPLY_TO_ALL_TARGET,
      model: { providerID: "anthropic", modelID: "claude-sonnet-4" },
    })
    const mixed = applyModelSelectionAction(selected, {
      type: "selectModel",
      target: taskSelectionTarget("task-b"),
      model: { providerID: "anthropic", modelID: "claude-opus-4" },
    })
    const applied = applyModelSelectionAction(mixed, {
      type: "selectVariant",
      target: APPLY_TO_ALL_TARGET,
      variant: "quick",
    })

    expect(applied.selections).toEqual({
      "task-a": { providerID: "anthropic", modelID: "claude-sonnet-4", variant: "quick" },
      "task-b": { providerID: "anthropic", modelID: "claude-opus-4" },
    })
  })

  test("apply-to-all resolves the requested model independently for every row", () => {
    const applyOnlyModel = {
      providerID: "provider",
      providerName: "Provider",
      modelID: "row-limited",
      displayName: "Row limited",
      variants: ["deep"],
    }
    const state = createModelSelectionState({
      tasks,
      models,
      applyToAllModels: [applyOnlyModel],
      rowOnlyModels: { "task-a": [applyOnlyModel] },
    })
    const applied = applyModelSelectionAction(state, {
      type: "selectModel",
      target: APPLY_TO_ALL_TARGET,
      model: {
        providerID: "provider",
        modelID: "row-limited",
        variant: "deep",
      },
    })

    expect(applied.applyToAllModel).toEqual({
      providerID: "provider",
      modelID: "row-limited",
      variant: "deep",
    })
    expect(applied.selections).toEqual({
      "task-a": {
        providerID: "provider",
        modelID: "row-limited",
        variant: "deep",
      },
    })
    expect(modelSelectionSubmitDisabled(applied)).toBe(true)
  })

  test("hydrates backend preselection so a valid batch can start without reselecting defaults", () => {
    const state = createModelSelectionState({
      tasks,
      models,
      preselectedModels: {
        "task-a": { providerID: "openai", modelID: "gpt-4.1" },
        "task-b": { providerID: "anthropic", modelID: "claude-sonnet-4", variant: "deep-reasoning" },
      },
    })

    expect(modelSelectionSubmitDisabled(state)).toBe(false)
    expect(buildModelSelectionSubmitParams(state)).toEqual({
      selections: [
        { taskID: "task-a", providerID: "openai", modelID: "gpt-4.1" },
        { taskID: "task-b", providerID: "anthropic", modelID: "claude-sonnet-4", variant: "deep-reasoning" },
      ],
    })
  })

  test("dropdown search preserves provider groups and filters by model text", () => {
    const searched = applyModelSelectionAction(
      applyModelSelectionAction(modelState(), {
        type: "openDropdown",
        target: taskSelectionTarget("task-a"),
      }),
      { type: "setSearch", value: "opus" },
    )

    expect(searched.dropdown).toEqual({
      openFor: taskSelectionTarget("task-a"),
      search: "opus",
    })
    expect(filteredModelGroups(searched)).toEqual([
      {
        providerID: "anthropic",
        providerName: "Anthropic",
        models: [{ providerID: "anthropic", providerName: "Anthropic", modelID: "claude-opus-4", displayName: "Claude Opus 4", variants: ["deep-reasoning"] }],
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
      target: APPLY_TO_ALL_TARGET,
      model: { providerID: "openai", modelID: "gpt-4.1" },
    })
    expect(modelSelectionSubmitDisabled(selected)).toBe(false)
  })

  test("keyboard commands cover submit, cancel, dropdown close, expand, and arrows", () => {
    const ready = applyModelSelectionAction(modelState(), {
      type: "selectModel",
      target: APPLY_TO_ALL_TARGET,
      model: { providerID: "openai", modelID: "gpt-4.1" },
    })
    expect(applyModelSelectionAction(ready, { type: "key", key: "Enter" }).commands.at(-1)).toEqual({ type: "submit" })
    expect(applyModelSelectionAction(ready, { type: "key", key: "Escape" }).commands.at(-1)).toEqual({ type: "cancel" })

    const rowFocused = applyModelSelectionAction(ready, { type: "key", key: "ArrowDown" })
    expect(rowFocused.focus).toBe(taskSelectionTarget("task-a"))
    expect(applyModelSelectionAction(rowFocused, { type: "key", key: "Enter", shift: true }).rows[0]?.expanded).toBe(true)

    const dropdown = applyModelSelectionAction(rowFocused, {
      type: "openDropdown",
      target: taskSelectionTarget("task-a"),
    })
    expect(applyModelSelectionAction(dropdown, { type: "key", key: "Escape", shift: true }).dropdown.openFor).toBeUndefined()
    expect(
      applyModelSelectionAction(rowFocused, {
        type: "key",
        key: "ArrowUp",
      }).focus,
    ).toBe(APPLY_TO_ALL_TARGET)
  })

  test("global Enter submits only when valid and not inside native controls", () => {
    const ready = applyModelSelectionAction(modelState(), {
      type: "selectModel",
      target: APPLY_TO_ALL_TARGET,
      model: { providerID: "openai", modelID: "gpt-4.1" },
    })

    expect(shouldSubmitModelSelectionFromKeyboard({ key: "Enter", targetTagName: "BODY" }, ready)).toBe(true)
    expect(shouldSubmitModelSelectionFromKeyboard({ key: "Enter", targetTagName: "SELECT" }, ready)).toBe(false)
    expect(shouldSubmitModelSelectionFromKeyboard({ key: "Enter", targetTagName: "BUTTON" }, ready)).toBe(false)
    expect(shouldSubmitModelSelectionFromKeyboard({ key: "Enter", targetTagName: "BODY" }, modelState())).toBe(false)
  })

  test("builds backend submit params with explicit variants and omits Auto", () => {
    const selected = applyModelSelectionAction(
      applyModelSelectionAction(modelState(), {
        type: "selectModel",
        target: taskSelectionTarget("task-b"),
        model: { providerID: "anthropic", modelID: "claude-opus-4" },
      }),
      {
        type: "selectModel",
        target: taskSelectionTarget("task-a"),
        model: {
          providerID: "anthropic",
          modelID: "claude-sonnet-4",
        },
      },
    )
    const ready = applyModelSelectionAction(selected, {
      type: "selectVariant",
      target: taskSelectionTarget("task-a"),
      variant: "quick",
    })

    expect(buildModelSelectionSubmitParams(ready)).toEqual({
      selections: [
        { taskID: "task-a", providerID: "anthropic", modelID: "claude-sonnet-4", variant: "quick" },
        { taskID: "task-b", providerID: "anthropic", modelID: "claude-opus-4" },
      ],
    })
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

    fixture.fromPlugin(encodeJsonRpc({ jsonrpc: "2.0", id: "start", method: "start", params: { mode: "model-selection", tasks, models } }))
    fixture.fromPicker(encodeJsonRpc({ jsonrpc: "2.0", method: "ready", params: { mode: "model-selection" } }))
    fixture.fromPicker(encodeJsonRpc({ jsonrpc: "2.0", method: "submit", params: { selections: [{ taskID: "task-a", providerID: "openai", modelID: "gpt-4.1", variant: "turbo" }] } }))

    expect(fixture.pluginMessages).toEqual([
      { jsonrpc: "2.0", method: "ready", params: { mode: "model-selection" } },
      { jsonrpc: "2.0", method: "submit", params: { selections: [{ taskID: "task-a", providerID: "openai", modelID: "gpt-4.1", variant: "turbo" }] } },
    ])
    expect(fixture.pickerMessages[0]).toMatchObject({ jsonrpc: "2.0", id: "start", method: "start" })
  })

  test("exchanges setup/config NDJSON JSON-RPC without importing root protocol code", () => {
    const fixture = createPickerContractFixture()
    const settings = defaultSetupSettings()

    fixture.fromPlugin(encodeJsonRpc({ jsonrpc: "2.0", id: 1, method: "start", params: { mode: "setup", settings } }))
    fixture.fromPicker(encodeJsonRpc({ jsonrpc: "2.0", method: "submit", params: { mode: "setup", scope: "global", settings } }))

    expect(decodeNdjson(fixture.pluginOut).at(-1)).toEqual({ jsonrpc: "2.0", method: "submit", params: { mode: "setup", scope: "global", settings } })
    expect(decodeNdjson(fixture.pickerOut).at(-1)).toEqual({ jsonrpc: "2.0", id: 1, method: "start", params: { mode: "setup", settings } })
  })

  test("passes OpenCode theme CSS through the picker contract", () => {
    const fixture = createPickerContractFixture()
    const theme = {
      mode: "dark",
      cssText: "--v2-background-bg-layer-01: #101820; --v2-text-text-base: #f7fafc;",
      cssVariables: { "opencode-bg": "#101820" },
    }

    fixture.fromPlugin(encodeJsonRpc({ jsonrpc: "2.0", id: "start", method: "start", params: { mode: "setup", settings: defaultSetupSettings(), theme } }))

    expect(fixture.pickerMessages[0]).toMatchObject({ jsonrpc: "2.0", id: "start", method: "start", params: { theme } })
  })
})

describe("picker theme bridge", () => {
  test("rejects control and bidirectional characters in runtime model identity", () => {
    const request = {
      jsonrpc: "2.0",
      id: "start",
      method: "start",
      params: {
        catalog: [{
          providerID: "custom",
          providerName: "OpenAI\u202e",
          models: [{
            providerID: "custom",
            providerName: "OpenAI\u202e",
            modelID: "gpt-5",
            modelName: "GPT-5",
            variants: [],
          }],
        }],
        applyToAllCatalog: [],
        rows: [{ callID: "call-1", agentName: "builder" }],
      },
    }

    expect(pickerRuntimeRequestFromLine(JSON.stringify(request))).toBeUndefined()

    request.params.catalog[0]!.providerName = "OpenAI"
    request.params.catalog[0]!.models[0]!.providerName = "OpenAI"
    for (const invisible of ["\u200b", "\u2060", "\u00ad", "\ufeff"]) {
      request.params.catalog[0]!.providerID = `open${invisible}ai`
      request.params.catalog[0]!.models[0]!.providerID = `open${invisible}ai`
      expect(pickerRuntimeRequestFromLine(JSON.stringify(request))).toBeUndefined()
    }
  })

  test("runtime adapter sends ready and converts start requests into picker runtime data", async () => {
    const received: unknown[] = []
    const written: string[] = []
    const adapter = createPickerRuntimeAdapter({
      listen: async (_event, handler) => {
        received.push(handler)
        return () => received.push("unlisten")
      },
      writeStdoutLine: async (line) => written.push(line),
    })

    let runtimeData
    const stop = await adapter.start((request) => (runtimeData = request))

    expect(decodeNdjson(`${written[0]}\n`)).toEqual([{ jsonrpc: "2.0", method: "ready" }])

    const handler = received[0] as (event: { payload: string }) => void
    handler({
      payload: JSON.stringify({
        jsonrpc: "2.0",
        id: "start",
        method: "start",
        params: {
          catalog: [
            {
              providerID: "anthropic",
              providerName: "Anthropic",
              models: [{ providerID: "anthropic", providerName: "Anthropic", modelID: "claude-sonnet-4", modelName: "Claude Sonnet 4", variants: ["quick", "deep-reasoning"] }],
            },
          ],
          applyToAllCatalog: [],
          rows: [{ callID: "call-1", agentName: "builder" }],
          theme: { themeID: "nightowl", colorScheme: "dark" },
        },
      }),
    })

    expect(runtimeData).toEqual({
      theme: { themeID: "nightowl", colorScheme: "dark" },
      modelSelection: {
        tasks: [{ id: "call-1", agentType: "builder", description: "" }],
        models: [{ providerID: "anthropic", providerName: "Anthropic", modelID: "claude-sonnet-4", displayName: "Claude Sonnet 4", variants: ["quick", "deep-reasoning"] }],
        applyToAllModels: [],
        preselectedModels: {},
      },
    })

    stop()
    expect(received).toContain("unlisten")
  })

  test("runtime adapter writes submit and cancel notifications to picker stdout", async () => {
    const written: string[] = []
    const adapter = createPickerRuntimeAdapter({
      listen: async () => () => undefined,
      writeStdoutLine: async (line) => written.push(line),
    })

    await adapter.submit({ selections: [{ taskID: "task-a", providerID: "openai", modelID: "gpt-4.1", variant: "turbo" }] })
    await adapter.cancel()

    expect(decodeNdjson(`${written[0]}\n${written[1]}\n`)).toEqual([
      { jsonrpc: "2.0", method: "submit", params: { selections: [{ taskID: "task-a", providerID: "openai", modelID: "gpt-4.1", variant: "turbo" }] } },
      { jsonrpc: "2.0", method: "cancel" },
    ])
  })

  test("converts backend picker request catalog rows into model-selection UI input", () => {
    const input = modelSelectionInputFromPickerRequest({
      catalog: [
        {
          providerID: "anthropic",
          providerName: "Anthropic",
          icon: "A",
          models: [{ providerID: "anthropic", providerName: "Anthropic", modelID: "claude-sonnet-4", modelName: "Claude Sonnet 4", variants: ["quick", "deep-reasoning"] }],
        },
      ],
      applyToAllCatalog: [
        {
          providerID: "openai",
          providerName: "OpenAI",
          icon: "AI",
          models: [{ providerID: "openai", providerName: "OpenAI", modelID: "gpt-4.1", modelName: "GPT-4.1", variants: ["turbo"] }],
        },
      ],
      rows: [
        {
          callID: "call-1",
          agentName: "builder",
          preselect: { providerID: "anthropic", providerName: "Anthropic", modelID: "claude-sonnet-4", modelName: "Claude Sonnet 4", variants: ["quick", "deep-reasoning"], variant: "quick", hidden: false, source: "agent" },
        },
      ],
    })

    expect(input).toEqual({
      tasks: [{ id: "call-1", agentType: "builder", description: "" }],
      models: [{ providerID: "anthropic", providerName: "Anthropic", modelID: "claude-sonnet-4", displayName: "Claude Sonnet 4", variants: ["quick", "deep-reasoning"] }],
      applyToAllModels: [{ providerID: "openai", providerName: "OpenAI", modelID: "gpt-4.1", displayName: "GPT-4.1", variants: ["turbo"] }],
      preselectedModels: { "call-1": { providerID: "anthropic", modelID: "claude-sonnet-4", variant: "quick" } },
    })
  })

  test("keeps a hidden preselection available only on its task row", () => {
    const input = modelSelectionInputFromPickerRequest({
      catalog: [{
        providerID: "anthropic",
        providerName: "Anthropic",
        models: [{
          providerID: "anthropic",
          providerName: "Anthropic",
          modelID: "visible",
          modelName: "Visible",
          variants: ["economy"],
        }],
      }],
      applyToAllCatalog: [{
        providerID: "anthropic",
        providerName: "Anthropic",
        models: [{
          providerID: "anthropic",
          providerName: "Anthropic",
          modelID: "visible",
          modelName: "Visible",
          variants: ["economy"],
        }],
      }],
      rows: [
        {
          callID: "hidden-row",
          agentName: "builder",
          description: "Inspect the hidden configured model",
          preselect: {
            providerID: "openai",
            providerName: "OpenAI",
            modelID: "configured-hidden",
            modelName: "Configured hidden",
            variants: ["deep-reasoning"],
            variant: "deep-reasoning",
            hidden: true,
            source: "agent",
          },
        },
        { callID: "other-row", agentName: "reviewer" },
      ],
    })

    expect(input.tasks[0]?.description).toBe("")
    expect(modelsForTaskRow(input, "hidden-row").map((model) => model.modelID)).toEqual([
      "visible",
      "configured-hidden",
    ])
    expect(modelsForTaskRow(input, "hidden-row").map((model) => model.variants)).toEqual([
      ["economy"],
      ["deep-reasoning"],
    ])
    expect(modelsForTaskRow(input, "other-row").map((model) => model.modelID)).toEqual([
      "visible",
    ])
    expect(input.applyToAllModels?.map((model) => model.modelID)).toEqual(["visible"])
    expect(input.preselectedModels?.["hidden-row"]).toEqual({
      providerID: "openai",
      modelID: "configured-hidden",
      variant: "deep-reasoning",
    })

    const hydrated = createModelSelectionState(input)
    const ready = applyModelSelectionAction(hydrated, {
      type: "selectModel",
      target: taskSelectionTarget("other-row"),
      model: { providerID: "anthropic", modelID: "visible" },
    })
    expect(hydrated.selections["hidden-row"]).toEqual({
      providerID: "openai",
      modelID: "configured-hidden",
      variant: "deep-reasoning",
    })
    expect(buildModelSelectionSubmitParams(ready).selections).toEqual([
      {
        taskID: "hidden-row",
        providerID: "openai",
        modelID: "configured-hidden",
        variant: "deep-reasoning",
      },
      { taskID: "other-row", providerID: "anthropic", modelID: "visible" },
    ])
  })

  test("production runtime data does not fall back to preview fixture", () => {
    const fixture = {
      theme: { themeID: "nightowl", colorScheme: "dark" },
      modelSelection: { tasks, models },
      setup: { settings: defaultSetupSettings(), scope: "project" as const },
    }

    expect(resolvePickerRuntimeData(new URLSearchParams(), undefined, fixture)).toBeUndefined()
    expect(resolvePickerRuntimeData(new URLSearchParams("preview=1"), undefined, fixture)).toEqual(fixture)
    expect(resolvePickerRuntimeData(new URLSearchParams(), { modelSelection: { tasks, models } }, fixture)).toEqual({
      modelSelection: { tasks, models },
    })
  })

  test("preview mode uses fixture model data instead of runtime IPC data", () => {
    const fixture = {
      theme: { themeID: "nightowl", colorScheme: "dark" },
      modelSelection: { tasks, models },
      setup: { settings: defaultSetupSettings(), scope: "project" as const },
    }
    const runtimeRequest = {
      theme: { themeID: "material", colorScheme: "light" },
      modelSelection: {
        tasks: [{ id: "runtime-task", agentType: "runtime", description: "Runtime IPC task" }],
        models: [{ providerID: "runtime", providerName: "Runtime", modelID: "model", displayName: "Runtime Model", variants: ["provider-special"] }],
      },
    }

    expect(resolvePickerRuntimeData(new URLSearchParams("preview=1&view=models"), runtimeRequest, fixture)).toEqual(fixture)
    expect(resolvePickerRuntimeData(new URLSearchParams("preview=1&view=settings"), runtimeRequest, fixture)).toEqual(fixture)
  })

  test("runtime IPC theme beats preview fixture theme when URL has no theme override", () => {
    const runtimeRequest = pickerRuntimeRequestFromLine(JSON.stringify({
      jsonrpc: "2.0",
      method: "start",
      params: {
        theme: { themeID: "material", colorScheme: "light" },
      },
    }))

    expect(resolvePickerThemeHint(new URLSearchParams("preview=1"), runtimeRequest, { themeID: "nightowl", colorScheme: "dark" })).toEqual({
      themeID: "material",
      colorScheme: "light",
    })
  })

  test("derives OpenCode theme from runtime picker request when URL has no theme override", () => {
    const hint = resolvePickerThemeHint(new URLSearchParams(), {
      theme: { themeID: "material", colorScheme: "light" },
    }, { themeID: "nightowl", colorScheme: "dark" })

    const css = resolveOpenCodeThemeCss(hint)

    expect(css.themeID).toBe("material")
    expect(css.mode).toBe("light")
  })

  test("keeps URL theme ahead of runtime request and preview fixture fallbacks", () => {
    const params = new URLSearchParams("themeID=nightowl&colorScheme=dark")

    expect(resolvePickerThemeHint(params, { theme: { themeID: "material", colorScheme: "light" } }, { themeID: "github", colorScheme: "light" })).toEqual({
      themeID: "nightowl",
      colorScheme: "dark",
    })
  })

  test("OpenCode CSS variables override fallback picker tokens", () => {
    const css = cssVariables(themeTokens.dark, {
      mode: "dark",
      cssText: "--v2-background-bg-layer-01: #101820; --v2-text-text-base: #f7fafc;",
      cssVariables: { "opencode-bg": "#101820" },
    })

    expect(css).toContain("--v2-background-bg-layer-01: #101820;")
    expect(css).toContain("--v2-text-text-base: #f7fafc;")
    expect(css).toContain("--opencode-bg: #101820;")
  })

  test("bundled OpenCode themes generate v1 and v2 CSS variables", () => {
    const css = resolveOpenCodeThemeCss({ themeID: "nightowl", colorScheme: "dark" })

    expect(css.themeID).toBe("nightowl")
    expect(css.mode).toBe("dark")
    expect(css.cssText).toContain("--background-base:")
    expect(css.cssText).toContain("--v2-background-bg-base:")
    expect(css.cssText).toContain("--v2-text-text-base:")
    expect(css.cssVariables["v2-background-bg-base"]).toBeDefined()
  })

  test("system color scheme follows the local OS preference without overriding explicit modes", () => {
    expect(resolveOpenCodeThemeCss({ colorScheme: "system" }, false).mode).toBe("dark")
    expect(resolveOpenCodeThemeCss({ colorScheme: "system" }, true).mode).toBe("light")
    expect(resolveOpenCodeThemeCss({ colorScheme: "dark" }, true).mode).toBe("dark")
    expect(resolveOpenCodeThemeCss({ colorScheme: "light" }, false).mode).toBe("light")
  })

  test("unknown theme and color scheme fall back safely", () => {
    const css = resolveOpenCodeThemeCss({ themeID: "does-not-exist", colorScheme: "neon" })

    expect(css.themeID).toBe("oc-2")
    expect(css.mode).toBe("dark")
    for (const inheritedName of ["__proto__", "constructor", "toString"]) {
      expect(
        resolveOpenCodeThemeCss({ themeID: inheritedName }).themeID,
      ).toBe("oc-2")
    }
  })
})
