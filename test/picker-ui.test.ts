import { describe, expect, test } from "bun:test"

import {
  applyModelSelectionAction,
  buildModelSelectionSubmitParams,
  createModelSelectionState,
  filteredModelGroups,
  modelSelectionSubmitDisabled,
  shouldSubmitModelSelectionFromKeyboard,
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
import { cssVariables, themeTokens } from "../picker/src/theme"
import { resolveOpenCodeThemeCss } from "../picker/src/opencode-theme-resolver"
import { modelSelectionInputFromPickerRequest, resolvePickerRuntimeData, resolvePickerThemeHint } from "../picker/src/runtime-request"
import { createPickerRuntimeAdapter, pickerRuntimeRequestFromLine } from "../picker/src/runtime-rpc"

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

  test("global Enter submits only when valid and not inside native controls", () => {
    const ready = applyModelSelectionAction(modelState(), {
      type: "selectModel",
      target: "apply-to-all",
      model: { providerID: "openai", modelID: "gpt-4.1" },
    })

    expect(shouldSubmitModelSelectionFromKeyboard({ key: "Enter", targetTagName: "BODY" }, ready)).toBe(true)
    expect(shouldSubmitModelSelectionFromKeyboard({ key: "Enter", targetTagName: "SELECT" }, ready)).toBe(false)
    expect(shouldSubmitModelSelectionFromKeyboard({ key: "Enter", targetTagName: "BUTTON" }, ready)).toBe(false)
    expect(shouldSubmitModelSelectionFromKeyboard({ key: "Enter", targetTagName: "BODY" }, modelState())).toBe(false)
  })

  test("builds backend submit params from task selections in row order", () => {
    const ready = applyModelSelectionAction(
      applyModelSelectionAction(modelState(), {
        type: "selectModel",
        target: "task-b",
        model: { providerID: "anthropic", modelID: "claude-opus-4" },
      }),
      { type: "selectModel", target: "task-a", model: { providerID: "openai", modelID: "gpt-4.1" } },
    )

    expect(buildModelSelectionSubmitParams(ready)).toEqual({
      selections: [
        { taskID: "task-a", providerID: "openai", modelID: "gpt-4.1" },
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
    fixture.fromPicker(encodeJsonRpc({ jsonrpc: "2.0", method: "submit", params: { selections: [{ taskID: "task-a", providerID: "openai", modelID: "gpt-4.1" }] } }))

    expect(fixture.pluginMessages).toEqual([
      { jsonrpc: "2.0", method: "ready", params: { mode: "model-selection" } },
      { jsonrpc: "2.0", method: "submit", params: { selections: [{ taskID: "task-a", providerID: "openai", modelID: "gpt-4.1" }] } },
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
              models: [{ providerID: "anthropic", providerName: "Anthropic", modelID: "claude-sonnet-4", modelName: "Claude Sonnet 4" }],
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
        tasks: [{ id: "call-1", agentType: "builder", description: "builder" }],
        models: [{ providerID: "anthropic", providerName: "Anthropic", modelID: "claude-sonnet-4", displayName: "Claude Sonnet 4" }],
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

    await adapter.submit({ selections: [{ taskID: "task-a", providerID: "openai", modelID: "gpt-4.1" }] })
    await adapter.cancel()

    expect(decodeNdjson(`${written[0]}\n${written[1]}\n`)).toEqual([
      { jsonrpc: "2.0", method: "submit", params: { selections: [{ taskID: "task-a", providerID: "openai", modelID: "gpt-4.1" }] } },
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
          models: [{ providerID: "anthropic", providerName: "Anthropic", modelID: "claude-sonnet-4", modelName: "Claude Sonnet 4" }],
        },
      ],
      applyToAllCatalog: [
        {
          providerID: "openai",
          providerName: "OpenAI",
          icon: "AI",
          models: [{ providerID: "openai", providerName: "OpenAI", modelID: "gpt-4.1", modelName: "GPT-4.1" }],
        },
      ],
      rows: [
        {
          callID: "call-1",
          agentName: "builder",
          preselect: { providerID: "anthropic", providerName: "Anthropic", modelID: "claude-sonnet-4", modelName: "Claude Sonnet 4", hidden: false, source: "agent" },
        },
      ],
    })

    expect(input).toEqual({
      tasks: [{ id: "call-1", agentType: "builder", description: "builder" }],
      models: [{ providerID: "anthropic", providerName: "Anthropic", modelID: "claude-sonnet-4", displayName: "Claude Sonnet 4" }],
      applyToAllModels: [{ providerID: "openai", providerName: "OpenAI", modelID: "gpt-4.1", displayName: "GPT-4.1" }],
      preselectedModels: { "call-1": { providerID: "anthropic", modelID: "claude-sonnet-4" } },
    })
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
        models: [{ providerID: "runtime", providerName: "Runtime", modelID: "model", displayName: "Runtime Model" }],
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

  test("unknown theme and color scheme fall back safely", () => {
    const css = resolveOpenCodeThemeCss({ themeID: "does-not-exist", colorScheme: "neon" })

    expect(css.themeID).toBe("oc-2")
    expect(css.mode).toBe("dark")
  })
})
