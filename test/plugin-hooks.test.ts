import { describe, expect, test } from "bun:test"

import { createModelDispatchPlugin, type ModelDispatchPluginDeps } from "../src/index"
import { DEFAULT_SETTINGS, type ModelDispatchSettings } from "../src/settings"
import { MODEL_DISPATCH_CANCELLED, MODEL_DISPATCH_PICKER_FAILED, type PluginLogEntry } from "../src/logging"

describe("plugin hook wiring", () => {
  test("returns hooks and custom configure tool", async () => {
    const { hooks } = await makePlugin({ enabled: false })

    expect(typeof hooks.config).toBe("function")
    expect(typeof hooks.event).toBe("function")
    expect(typeof hooks.dispose).toBe("function")
    expect(typeof hooks["tool.execute.before"]).toBe("function")
    expect(typeof hooks["tool.execute.after"]).toBe("function")
    expect(typeof hooks.tool?.configure_model_dispatch?.execute).toBe("function")
  })

  test("opens first-run setup at plugin load and configure tool launches configuration", async () => {
    let firstRunOpened = 0
    let configureOpened = 0
    const { hooks } = await makePlugin({
      enabled: false,
      shouldOpenFirstRunSetup: async () => true,
      openFirstRunSetup: async () => {
        firstRunOpened++
      },
      configureModelDispatch: async () => {
        configureOpened++
        return "configured"
      },
    })

    expect(firstRunOpened).toBe(1)
    await expect(hooks.tool?.configure_model_dispatch?.execute({} as never)).resolves.toBe("configured")
    expect(configureOpened).toBe(1)
  })

  test("disabled dispatch leaves task args unchanged", async () => {
    const { hooks, pickerRequests } = await makePlugin({ enabled: false })
    const args = { subagent_type: "builder", prompt: "keep secret" }
    const output = { args }

    await hooks["tool.execute.before"]!({ tool: "task", sessionID: "parent", callID: "call-1" }, output)

    expect(output.args).toBe(args)
    expect(pickerRequests).toEqual([])
  })

  test("enabled successful task selection waits for the batch result and rewrites only subagent_type to the shadow key", async () => {
    const { hooks, pickerRequests, cache } = await makePlugin({ enabled: true })
    const args = { subagent_type: "builder", prompt: "keep secret", description: "also secret" }
    const output = { args }

    await hooks["tool.execute.before"]!({ tool: "task", sessionID: "parent", callID: "call-1" }, output)

    expect(pickerRequests).toHaveLength(1)
    expect(pickerRequests[0]?.sessionID).toBe("parent")
    expect(pickerRequests[0]?.rows.map((row) => row.callID)).toEqual(["call-1"])
    expect(output.args).toEqual({ ...args, subagent_type: "shadow-builder-anthropic-claude" })
    expect(await cache.getShadowForCall("call-1")).toBe("shadow-builder-anthropic-claude")

    const config: { agent?: Record<string, unknown> } = {}
    await hooks.config!(config)
    expect(config.agent?.["shadow-builder-anthropic-claude"]).toMatchObject({
      name: "builder",
      model: { providerID: "anthropic", modelID: "claude" },
    })
  })

  test("passes picker theme from appearance settings with env override", async () => {
    const previousTheme = process.env.OPENCODE_MODEL_DISPATCH_THEME_ID
    const previousScheme = process.env.OPENCODE_MODEL_DISPATCH_COLOR_SCHEME
    process.env.OPENCODE_MODEL_DISPATCH_THEME_ID = "nightowl"
    process.env.OPENCODE_MODEL_DISPATCH_COLOR_SCHEME = "dark"
    try {
      const { hooks, pickerRequests } = await makePlugin({ enabled: true, appearance: { theme_id: "material", color_scheme: "light" } })

      await hooks["tool.execute.before"]!({ tool: "task", sessionID: "parent", callID: "call-1" }, { args: { subagent_type: "builder" } })

      expect(pickerRequests[0]?.theme).toEqual({ themeID: "nightowl", colorScheme: "dark" })
    } finally {
      if (previousTheme === undefined) delete process.env.OPENCODE_MODEL_DISPATCH_THEME_ID
      else process.env.OPENCODE_MODEL_DISPATCH_THEME_ID = previousTheme
      if (previousScheme === undefined) delete process.env.OPENCODE_MODEL_DISPATCH_COLOR_SCHEME
      else process.env.OPENCODE_MODEL_DISPATCH_COLOR_SCHEME = previousScheme
    }
  })

  test("passes picker theme from appearance settings", async () => {
    const { hooks, pickerRequests } = await makePlugin({ enabled: true, appearance: { theme_id: "material", color_scheme: "light" } })

    await hooks["tool.execute.before"]!({ tool: "task", sessionID: "parent", callID: "call-1" }, { args: { subagent_type: "builder" } })

    expect(pickerRequests[0]?.theme).toEqual({ themeID: "material", colorScheme: "light" })
  })

  test("cancel throws and logs MODEL_DISPATCH_CANCELLED without starting subagents", async () => {
    const { hooks, entries, cache } = await makePlugin({ enabled: true, pickerDecision: { kind: "cancel" } })

    await expect(hooks["tool.execute.before"]!({ tool: "task", sessionID: "parent", callID: "call-1" }, { args: { subagent_type: "builder" } })).rejects.toThrow(
      "Model selection cancelled",
    )

    expect(await cache.getShadowForCall("call-1")).toBeUndefined()
    expect(entries).toEqual([
      expect.objectContaining({ event: "model_dispatch_failure", code: MODEL_DISPATCH_CANCELLED, category: "user_cancelled" }),
    ])
  })

  test("technical picker failure leaves args unchanged, emits warning path, and logs when enabled", async () => {
    const args = { subagent_type: "builder", prompt: "secret prompt" }
    const output: { args: typeof args; warnings?: string[] } = { args }
    const { hooks, entries } = await makePlugin({ enabled: true, pickerDecision: { kind: "technical_failure", reason: "picker crashed" } })

    await hooks["tool.execute.before"]!({ tool: "task", sessionID: "parent", callID: "call-1" }, output)

    expect(output.args).toBe(args)
    expect(output.warnings).toEqual(["Model dispatch picker failed; using the configured fallback model."])
    expect(entries).toEqual([
      expect.objectContaining({ event: "model_dispatch_failure", code: MODEL_DISPATCH_PICKER_FAILED, category: "technical_failure" }),
    ])
    expect(JSON.stringify(entries)).not.toContain("secret prompt")
  })

  test("technical picker failure still returns warnings when logging is disabled", async () => {
    const output: { args: Record<string, unknown>; warnings?: string[] } = { args: { subagent_type: "builder" } }
    const { hooks, entries } = await makePlugin({ enabled: true, loggingEnabled: false, pickerDecision: { kind: "technical_failure", reason: "picker crashed" } })

    await hooks["tool.execute.before"]!({ tool: "task", sessionID: "parent", callID: "call-1" }, output)

    expect(entries).toEqual([])
    expect(output.warnings).toEqual(["Model dispatch picker failed; using the configured fallback model."])
  })

  test("after hook maps the task call id to the child session id from metadata", async () => {
    const { hooks, cache } = await makePlugin({ enabled: true })
    await hooks["tool.execute.before"]!({ tool: "task", sessionID: "parent", callID: "call-1" }, { args: { subagent_type: "builder" } })

    await hooks["tool.execute.after"]!({ tool: "task", sessionID: "parent", callID: "call-1", args: {} }, { title: "", output: "", metadata: { sessionID: "child-1" } })

    expect(await cache.getChildSessionForShadow("shadow-builder-anthropic-claude")).toBe("child-1")
  })

  test("multiple parallel task calls batch into one picker and resolve independently", async () => {
    const { hooks, pickerRequests } = await makePlugin({
      enabled: true,
      pickerDecision: {
        kind: "submit",
        payload: {
          selections: [
            { callID: "call-1", model: { providerID: "anthropic", modelID: "claude" } },
            { callID: "call-2", model: { providerID: "openai", modelID: "gpt" } },
          ],
        },
      },
    })
    const first = { args: { subagent_type: "builder", prompt: "first" } }
    const second = { args: { subagent_type: "reviewer", prompt: "second" } }

    await Promise.all([
      hooks["tool.execute.before"]!({ tool: "task", sessionID: "parent", callID: "call-1" }, first),
      hooks["tool.execute.before"]!({ tool: "task", sessionID: "parent", callID: "call-2" }, second),
    ])

    expect(pickerRequests).toHaveLength(1)
    expect(pickerRequests[0]?.rows.map((row) => row.callID)).toEqual(["call-1", "call-2"])
    expect(first.args.subagent_type).toBe("shadow-builder-anthropic-claude")
    expect(second.args.subagent_type).toBe("shadow-reviewer-openai-gpt")
  })

  test("accepts picker row selections keyed by taskID", async () => {
    const { hooks } = await makePlugin({
      enabled: true,
      pickerDecision: {
        kind: "submit",
        payload: { selections: [{ taskID: "call-1", providerID: "anthropic", modelID: "claude" }] },
      },
    })
    const output = { args: { subagent_type: "builder" } }

    await hooks["tool.execute.before"]!({ tool: "task", sessionID: "parent", callID: "call-1" }, output)

    expect(output.args.subagent_type).toBe("shadow-builder-anthropic-claude")
  })

  test("apply-to-all selection applies one model to every task row", async () => {
    const { hooks } = await makePlugin({
      enabled: true,
      pickerDecision: { kind: "submit", payload: { applyToAll: { providerID: "anthropic", modelID: "claude" } } },
    })
    const first = { args: { subagent_type: "builder" } }
    const second = { args: { subagent_type: "reviewer" } }

    await Promise.all([
      hooks["tool.execute.before"]!({ tool: "task", sessionID: "parent", callID: "call-1" }, first),
      hooks["tool.execute.before"]!({ tool: "task", sessionID: "parent", callID: "call-2" }, second),
    ])

    expect(first.args.subagent_type).toBe("shadow-builder-anthropic-claude")
    expect(second.args.subagent_type).toBe("shadow-reviewer-anthropic-claude")
  })

  test("separate sessions dispatch separate batches", async () => {
    const { hooks, pickerRequests } = await makePlugin({ enabled: true })

    await Promise.all([
      hooks["tool.execute.before"]!({ tool: "task", sessionID: "parent-1", callID: "call-1" }, { args: { subagent_type: "builder" } }),
      hooks["tool.execute.before"]!({ tool: "task", sessionID: "parent-2", callID: "call-2" }, { args: { subagent_type: "reviewer" } }),
    ])

    expect(pickerRequests.map((request) => request.sessionID).sort()).toEqual(["parent-1", "parent-2"])
  })
})

async function makePlugin(options: {
  enabled: boolean
  loggingEnabled?: boolean
  pickerDecision?: { kind: "submit"; payload: unknown } | { kind: "cancel" } | { kind: "technical_failure"; reason: string }
  shouldOpenFirstRunSetup?: ModelDispatchPluginDeps["shouldOpenFirstRunSetup"]
  openFirstRunSetup?: ModelDispatchPluginDeps["openFirstRunSetup"]
  configureModelDispatch?: ModelDispatchPluginDeps["configureModelDispatch"]
  appearance?: ModelDispatchSettings["appearance"]
}) {
  const entries: PluginLogEntry[] = []
  const pickerRequests: Array<{ sessionID: string; rows: Array<{ callID: string }>; theme?: unknown }> = []
  const cache = new MemoryShadowCache()
  const settings: ModelDispatchSettings = {
    ...DEFAULT_SETTINGS,
    privacy: { logging_enabled: options.loggingEnabled ?? true },
    dispatch: { ...DEFAULT_SETTINGS.dispatch, enabled: options.enabled, batch_ms: 0 },
    appearance: options.appearance ?? {},
  }
  const deps: ModelDispatchPluginDeps = {
    readSettings: async () => ({ settings, warnings: [] }),
    logger: { info: (entry) => entries.push(entry), error: (entry) => entries.push(entry) },
    cache,
    scheduleBatch: (fn) => queueMicrotask(fn),
    launchPicker: async (request) => {
      pickerRequests.push({ sessionID: request.sessionID, rows: request.rows, theme: request.theme })
      return options.pickerDecision ?? { kind: "submit", payload: { applyToAll: { providerID: "anthropic", modelID: "claude" } } }
    },
    createShadowAgent: (sourceAgent, model) => {
      const key = `shadow-${sourceAgent.name}-${model.providerID}-${model.modelID}`
      return { key, definition: { ...sourceAgent, model }, config: { agent: { [key]: { ...sourceAgent, model } } } }
    },
    shouldOpenFirstRunSetup: options.shouldOpenFirstRunSetup,
    openFirstRunSetup: options.openFirstRunSetup,
    configureModelDispatch: options.configureModelDispatch,
  }
  const plugin = createModelDispatchPlugin(deps)
  const hooks = await plugin({ client: fakeClient() } as never)
  return { hooks, entries, pickerRequests, cache }
}

function fakeClient() {
  return {
    app: {
      models: async () => [
        { id: "anthropic", name: "Anthropic", models: [{ id: "claude", name: "Claude", visible: true }] },
        { id: "openai", name: "OpenAI", models: [{ id: "gpt", name: "GPT", visible: true }] },
      ],
      agents: async () => [
        { name: "builder", prompt: "build", permissions: { edit: "allow" } },
        { name: "reviewer", prompt: "review", permissions: { edit: "deny" } },
      ],
    },
    session: { messages: async () => [] },
  }
}

class MemoryShadowCache {
  readonly calls = new Map<string, string>()
  readonly children = new Map<string, string>()

  async recordBeforeTask(callID: string, shadowKey: string) {
    this.calls.set(callID, shadowKey)
  }

  async recordAfterTask(callID: string, metadata: { sessionID?: string; childSessionID?: string; session?: { id?: string } }) {
    const childSessionID = metadata.childSessionID ?? metadata.sessionID ?? metadata.session?.id
    const shadowKey = this.calls.get(callID)
    if (childSessionID && shadowKey) this.children.set(shadowKey, childSessionID)
  }

  async getShadowForCall(callID: string) {
    return this.calls.get(callID)
  }

  async getChildSessionForShadow(shadowKey: string) {
    return this.children.get(shadowKey)
  }

  async handleSessionUpdated() {}

  async dispose() {}
}
