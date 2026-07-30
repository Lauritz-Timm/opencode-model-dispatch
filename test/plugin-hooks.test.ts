import { describe, expect, test } from "bun:test"

import { createModelDispatchPlugin, type ModelDispatchPluginDeps } from "../src/index"
import { DEFAULT_SETTINGS, type ModelDispatchSettings } from "../src/settings"
import { MODEL_DISPATCH_CANCELLED, MODEL_DISPATCH_PICKER_FAILED, type PluginLogEntry } from "../src/logging"

describe("plugin hook wiring", () => {
  test("returns hooks and custom configure tool", async () => {
    const { hooks } = await makePlugin({ enabled: false })

    expect(typeof hooks.dispose).toBe("function")
    expect(typeof hooks["chat.message"]).toBe("function")
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

  test("enabled selection keeps the original agent and overrides the child message model", async () => {
    const { hooks, pickerRequests, persistedModels } = await makePlugin({ enabled: true })
    const args = { subagent_type: "builder", prompt: "keep secret", description: "also secret" }
    const output = { args }

    await hooks["tool.execute.before"]!({ tool: "task", sessionID: "parent", callID: "call-1" }, output)

    expect(pickerRequests).toHaveLength(1)
    expect(pickerRequests[0]?.sessionID).toBe("parent")
    expect(pickerRequests[0]?.rows.map((row) => row.callID)).toEqual(["call-1"])
    expect(output.args).toBe(args)
    const chatInput = {
      sessionID: "child-1",
      agent: "builder",
      model: { providerID: "default", modelID: "default" },
      variant: "reasoning-high",
    }
    const chatOutput = {
      message: { model: { providerID: "default", modelID: "default", variant: "reasoning-high" as string | undefined } },
      parts: [],
    }
    await hooks["chat.message"]!(chatInput, chatOutput as never)
    expect(chatInput.model).toEqual({ providerID: "anthropic", modelID: "claude" })
    expect(chatInput.variant).toBeUndefined()
    expect(chatOutput.message.model).toEqual({ providerID: "anthropic", modelID: "claude" })
    expect(persistedModels).toEqual([
      { sessionID: "child-1", model: { providerID: "anthropic", modelID: "claude" } },
    ])
  })

  test("applies and persists an explicitly selected provider effort variant", async () => {
    const { hooks, persistedModels } = await makePlugin({
      enabled: true,
      pickerDecision: {
        kind: "submit",
        payload: {
          selections: [{
            taskID: "call-1",
            providerID: "anthropic",
            modelID: "claude",
            variant: "high",
          }],
        },
      },
    })
    await hooks["tool.execute.before"]!(
      { tool: "task", sessionID: "parent", callID: "call-1" },
      { args: { subagent_type: "builder" } },
    )
    const input = {
      sessionID: "child-1",
      agent: "builder",
      model: { providerID: "default", modelID: "default" },
      variant: "low",
    }
    const output = {
      message: { model: { providerID: "default", modelID: "default", variant: "low" as string | undefined } },
      parts: [],
    }

    await hooks["chat.message"]!(input, output as never)

    expect(input.variant).toBe("high")
    expect(output.message.model).toEqual({
      providerID: "anthropic",
      modelID: "claude",
      variant: "high",
    })
    expect(persistedModels).toEqual([{
      sessionID: "child-1",
      model: { providerID: "anthropic", modelID: "claude", variant: "high" },
    }])
    const taskOutput = {
      metadata: { model: { providerID: "default", modelID: "default" } },
    }
    await hooks["tool.execute.after"]!(
      { tool: "task", sessionID: "parent", callID: "call-1", args: {} },
      taskOutput as never,
    )
    expect(taskOutput.metadata.model).toEqual({
      providerID: "anthropic",
      modelID: "claude",
      variant: "high",
    })
  })

  test("Auto preserves the existing effort only when the selected model still matches", async () => {
    const { hooks, persistedModels } = await makePlugin({ enabled: true })
    await hooks["tool.execute.before"]!(
      { tool: "task", sessionID: "parent", callID: "call-1" },
      { args: { subagent_type: "builder" } },
    )
    const input = {
      sessionID: "child-1",
      agent: "builder",
      model: { providerID: "anthropic", modelID: "claude" },
      variant: "medium",
    }
    const output = {
      message: { model: { providerID: "anthropic", modelID: "claude", variant: "medium" as string | undefined } },
      parts: [],
    }

    await hooks["chat.message"]!(input, output as never)

    expect(input.variant).toBe("medium")
    expect(output.message.model).toEqual({
      providerID: "anthropic",
      modelID: "claude",
      variant: "medium",
    })
    expect(persistedModels).toEqual([{
      sessionID: "child-1",
      model: { providerID: "anthropic", modelID: "claude", variant: "medium" },
    }])
  })

  test("rejects an effort value that the selected model did not advertise", async () => {
    const { hooks, toasts } = await makePlugin({
      enabled: true,
      pickerDecision: {
        kind: "submit",
        payload: {
          selections: [{
            taskID: "call-1",
            providerID: "anthropic",
            modelID: "claude",
            variant: "unadvertised",
          }],
        },
      },
    })
    await hooks["tool.execute.before"]!(
      { tool: "task", sessionID: "parent", callID: "call-1" },
      { args: { subagent_type: "builder" } },
    )
    const output = {
      message: { model: { providerID: "anthropic", modelID: "claude", variant: "medium" } },
      parts: [],
    }

    await hooks["chat.message"]!(
      { sessionID: "child-1", agent: "builder", variant: "medium" },
      output as never,
    )

    expect(output.message.model).toEqual({
      providerID: "anthropic",
      modelID: "claude",
      variant: "medium",
    })
    expect(toasts).toHaveLength(1)
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

  test("follows the active local OpenCode theme when no appearance override is set", async () => {
    const { hooks, pickerRequests } = await makePlugin({
      enabled: true,
      hostTheme: "catppuccin",
    })

    await hooks["tool.execute.before"]!(
      { tool: "task", sessionID: "parent", callID: "call-1" },
      { args: { subagent_type: "builder" } },
    )

    expect(pickerRequests[0]?.theme).toEqual({
      themeID: "catppuccin",
      colorScheme: "system",
    })
  })

  test("cancel throws and logs MODEL_DISPATCH_CANCELLED without starting subagents", async () => {
    const { hooks, entries } = await makePlugin({ enabled: true, pickerDecision: { kind: "cancel" } })

    await expect(hooks["tool.execute.before"]!({ tool: "task", sessionID: "parent", callID: "call-1" }, { args: { subagent_type: "builder" } })).rejects.toThrow(
      "Model selection cancelled",
    )

    expect(entries).toEqual([
      expect.objectContaining({ event: "model_dispatch_failure", code: MODEL_DISPATCH_CANCELLED, category: "user_cancelled" }),
    ])
  })

  test("technical picker failure leaves args unchanged, emits warning path, and logs when enabled", async () => {
    const args = { subagent_type: "builder", prompt: "secret prompt" }
    const output = { args }
    const { hooks, entries, toasts } = await makePlugin({ enabled: true, pickerDecision: { kind: "technical_failure", reason: "picker crashed" } })

    await hooks["tool.execute.before"]!({ tool: "task", sessionID: "parent", callID: "call-1" }, output)

    expect(output.args).toBe(args)
    expect(toasts).toEqual([expect.objectContaining({
      body: expect.objectContaining({ message: "Model dispatch picker failed; using the configured fallback model.", variant: "warning" }),
    })])
    expect(entries).toEqual([
      expect.objectContaining({ event: "model_dispatch_failure", code: MODEL_DISPATCH_PICKER_FAILED, category: "technical_failure" }),
    ])
    expect(JSON.stringify(entries)).not.toContain("secret prompt")
  })

  test("technical picker failure still returns warnings when logging is disabled", async () => {
    const output = { args: { subagent_type: "builder" } }
    const { hooks, entries, toasts } = await makePlugin({ enabled: true, loggingEnabled: false, pickerDecision: { kind: "technical_failure", reason: "picker crashed" } })

    await hooks["tool.execute.before"]!({ tool: "task", sessionID: "parent", callID: "call-1" }, output)

    expect(entries).toEqual([])
    expect(toasts).toHaveLength(1)
  })

  test("after hook reports the selected model in task metadata", async () => {
    const { hooks } = await makePlugin({ enabled: true })
    await hooks["tool.execute.before"]!({ tool: "task", sessionID: "parent", callID: "call-1" }, { args: { subagent_type: "builder" } })
    await hooks["chat.message"]!(
      { sessionID: "child-1", agent: "builder" },
      { message: { model: { providerID: "default", modelID: "default" } }, parts: [] } as never,
    )

    const output = { title: "", output: "", metadata: { sessionID: "child-1", model: { providerID: "default", modelID: "default" } } }
    await hooks["tool.execute.after"]!({ tool: "task", sessionID: "parent", callID: "call-1", args: {} }, output)

    expect(output.metadata.model).toEqual({ providerID: "anthropic", modelID: "claude" })
  })

  test("does not report a selection in metadata unless a child message consumed it", async () => {
    const { hooks } = await makePlugin({ enabled: true })
    await hooks["tool.execute.before"]!({ tool: "task", sessionID: "parent", callID: "call-1" }, { args: { subagent_type: "builder" } })
    const output = { metadata: { model: { providerID: "default", modelID: "default" } } }

    await hooks["tool.execute.after"]!({ tool: "task", sessionID: "parent", callID: "call-1", args: {} }, output as never)

    expect(output.metadata.model).toEqual({ providerID: "default", modelID: "default" })
  })

  test("keeps the first-message override when session-model persistence fails and warns", async () => {
    const { hooks, toasts } = await makePlugin({ enabled: true, persistenceError: new Error("server rejected update") })
    await hooks["tool.execute.before"]!({ tool: "task", sessionID: "parent", callID: "call-1" }, { args: { subagent_type: "builder" } })
    const message = { message: { model: { providerID: "default", modelID: "default" } }, parts: [] }

    await hooks["chat.message"]!({ sessionID: "child-1", agent: "builder" }, message as never)

    expect(message.message.model).toEqual({ providerID: "anthropic", modelID: "claude" })
    expect(toasts).toHaveLength(1)
  })

  test("after hook tolerates an undefined task result after OpenCode reports a tool failure", async () => {
    const { hooks } = await makePlugin({ enabled: true })
    await hooks["tool.execute.before"]!({ tool: "task", sessionID: "parent", callID: "call-1" }, { args: { subagent_type: "builder" } })
    await hooks["chat.message"]!(
      { sessionID: "child-1", agent: "builder" },
      { message: { model: { providerID: "default", modelID: "default" } }, parts: [] } as never,
    )

    await expect(
      hooks["tool.execute.after"]!(
        { tool: "task", sessionID: "parent", callID: "call-1", args: {} },
        undefined as never,
      ),
    ).resolves.toBeUndefined()
  })

  test("falls back and completes the task hook when catalog or picker dispatch throws", async () => {
    const args = { subagent_type: "builder", prompt: "private prompt" }
    const { hooks, entries, toasts } = await makePlugin({
      enabled: true,
      pickerError: new Error("picker integration exploded"),
    })

    await expect(
      hooks["tool.execute.before"]!({ tool: "task", sessionID: "parent", callID: "call-1" }, { args }),
    ).resolves.toBeUndefined()

    expect(toasts).toHaveLength(1)
    expect(entries).toEqual([
      expect.objectContaining({ code: MODEL_DISPATCH_PICKER_FAILED, category: "technical_failure" }),
    ])
    expect(JSON.stringify(entries)).not.toContain("private prompt")
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
    expect(first.args.subagent_type).toBe("builder")
    expect(second.args.subagent_type).toBe("reviewer")
    const builderMessage = { message: { model: { providerID: "default", modelID: "default" } }, parts: [] }
    const reviewerMessage = { message: { model: { providerID: "default", modelID: "default" } }, parts: [] }
    await Promise.all([
      hooks["chat.message"]!({ sessionID: "child-1", agent: "builder" }, builderMessage as never),
      hooks["chat.message"]!({ sessionID: "child-2", agent: "reviewer" }, reviewerMessage as never),
    ])
    expect(builderMessage.message.model).toEqual({ providerID: "anthropic", modelID: "claude" })
    expect(reviewerMessage.message.model).toEqual({ providerID: "openai", modelID: "gpt" })
  })

  test("serializes parallel calls to the same agent so child sessions cannot consume each other's model", async () => {
    const { hooks } = await makePlugin({
      enabled: true,
      pickerDecision: {
        kind: "submit",
        payload: {
          selections: [
            { taskID: "call-1", providerID: "anthropic", modelID: "claude" },
            { taskID: "call-2", providerID: "openai", modelID: "gpt" },
          ],
        },
      },
    })
    const first = hooks["tool.execute.before"]!(
      { tool: "task", sessionID: "parent", callID: "call-1" },
      { args: { subagent_type: "builder" } },
    )
    let secondSettled = false
    const second = hooks["tool.execute.before"]!(
      { tool: "task", sessionID: "parent", callID: "call-2" },
      { args: { subagent_type: "builder" } },
    ).then(() => {
      secondSettled = true
    })

    await first
    await Promise.resolve()
    expect(secondSettled).toBe(false)

    const firstMessage = { message: { model: { providerID: "default", modelID: "default" } }, parts: [] }
    await hooks["chat.message"]!({ sessionID: "child-1", agent: "builder" }, firstMessage as never)
    await second

    const secondMessage = { message: { model: { providerID: "default", modelID: "default" } }, parts: [] }
    await hooks["chat.message"]!({ sessionID: "child-2", agent: "builder" }, secondMessage as never)

    expect(firstMessage.message.model).toEqual({ providerID: "anthropic", modelID: "claude" })
    expect(secondMessage.message.model).toEqual({ providerID: "openai", modelID: "gpt" })
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

    const message = { message: { model: { providerID: "default", modelID: "default" } }, parts: [] }
    await hooks["chat.message"]!({ sessionID: "child-1", agent: "builder" }, message as never)
    expect(message.message.model).toEqual({ providerID: "anthropic", modelID: "claude" })
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

    const firstMessage = { message: { model: { providerID: "default", modelID: "default" } }, parts: [] }
    const secondMessage = { message: { model: { providerID: "default", modelID: "default" } }, parts: [] }
    await Promise.all([
      hooks["chat.message"]!({ sessionID: "child-1", agent: "builder" }, firstMessage as never),
      hooks["chat.message"]!({ sessionID: "child-2", agent: "reviewer" }, secondMessage as never),
    ])
    expect(firstMessage.message.model).toEqual({ providerID: "anthropic", modelID: "claude" })
    expect(secondMessage.message.model).toEqual({ providerID: "anthropic", modelID: "claude" })
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
  hostTheme?: string
  pickerError?: Error
  persistenceError?: Error
}) {
  const entries: PluginLogEntry[] = []
  const toasts: unknown[] = []
  const pickerRequests: Array<{ sessionID: string; rows: Array<{ callID: string }>; theme?: unknown }> = []
  const persistedModels: Array<{ sessionID: string; model: { providerID: string; modelID: string; variant?: string } }> = []
  const settings: ModelDispatchSettings = {
    ...DEFAULT_SETTINGS,
    privacy: { logging_enabled: options.loggingEnabled ?? true },
    dispatch: { ...DEFAULT_SETTINGS.dispatch, enabled: options.enabled, batch_ms: 0 },
    appearance: options.appearance ?? {},
  }
  const deps: ModelDispatchPluginDeps = {
    readSettings: async () => ({ settings, warnings: [] }),
    logger: { info: (entry) => entries.push(entry), error: (entry) => entries.push(entry) },
    scheduleBatch: (fn) => queueMicrotask(fn),
    launchPicker: async (request) => {
      pickerRequests.push({ sessionID: request.sessionID, rows: request.rows, theme: request.theme })
      if (options.pickerError) throw options.pickerError
      return options.pickerDecision ?? { kind: "submit", payload: { applyToAll: { providerID: "anthropic", modelID: "claude" } } }
    },
    shouldOpenFirstRunSetup: options.shouldOpenFirstRunSetup ?? (async () => false),
    openFirstRunSetup: options.openFirstRunSetup,
    configureModelDispatch: options.configureModelDispatch,
    persistSessionModel: async (sessionID, model) => {
      if (options.persistenceError) throw options.persistenceError
      persistedModels.push({ sessionID, model })
    },
  }
  const plugin = createModelDispatchPlugin(deps)
  const hooks = await plugin({
    client: fakeClient(toasts, options.hostTheme),
    directory: "/scratch",
  } as never)
  return { hooks, entries, pickerRequests, toasts, persistedModels }
}

function fakeClient(toasts: unknown[] = [], hostTheme?: string) {
  return {
    ...(hostTheme
      ? {
          config: {
            get: async () => ({ data: { theme: hostTheme } }),
          },
        }
      : {}),
    app: {
      models: async () => [
        { id: "anthropic", name: "Anthropic", models: [{ id: "claude", name: "Claude", visible: true, variants: { low: {}, medium: {}, high: {} } }] },
        { id: "openai", name: "OpenAI", models: [{ id: "gpt", name: "GPT", visible: true, variants: { low: {}, high: {} } }] },
      ],
      agents: async () => [
        { name: "builder", prompt: "build", permissions: { edit: "allow" } },
        { name: "reviewer", prompt: "review", permissions: { edit: "deny" } },
      ],
    },
    session: {
      messages: async () => [],
      get: async (options: { path: { id: string } }) => ({
        data: { id: options.path.id, parentID: options.path.id.startsWith("child-") ? "parent" : undefined },
      }),
    },
    tui: {
      showToast: async (options: unknown) => {
        toasts.push(options)
        return { data: true }
      },
    },
  }
}
