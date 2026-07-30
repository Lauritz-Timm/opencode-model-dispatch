import { describe, expect, test } from "bun:test"

import { createModelDispatchPlugin, type PickerRequest } from "../../src/index"
import { DEFAULT_SETTINGS, type ModelDispatchSettings } from "../../src/settings"
import type { PluginLogEntry } from "../../src/logging"

describe("e2e plugin dispatch flow", () => {
  test("batches parallel task calls and applies models to real child-message hooks without changing agent identity", async () => {
    const logEntries: PluginLogEntry[] = []
    const pickerRequests: PickerRequest[] = []
    const settings: ModelDispatchSettings = {
      ...DEFAULT_SETTINGS,
      dispatch: { ...DEFAULT_SETTINGS.dispatch, enabled: true, batch_ms: 0 },
    }
    const plugin = createModelDispatchPlugin({
      readSettings: async () => ({ settings, warnings: [] }),
      shouldOpenFirstRunSetup: async () => false,
      logger: { info: (entry) => logEntries.push(entry), error: (entry) => logEntries.push(entry) },
      scheduleBatch: (fn) => queueMicrotask(fn),
      launchPicker: async (request) => {
        pickerRequests.push(request)
        return {
          kind: "submit",
          payload: {
            selections: [
              { taskID: "call-build", providerID: "anthropic", modelID: "claude-3-5-sonnet" },
              { taskID: "call-review", providerID: "openai", modelID: "gpt-4o" },
            ],
          },
        }
      },
    })
    const hooks = await plugin({ client: fakeClient(), directory: "C:/scratch" } as never)
    const build = { args: { subagent_type: "builder", prompt: "do not leak this prompt" } }
    const review = { args: { subagent_type: "reviewer", description: "do not leak this description" } }

    await Promise.all([
      hooks["tool.execute.before"]!({ tool: "task", sessionID: "parent", callID: "call-build" }, build),
      hooks["tool.execute.before"]!({ tool: "task", sessionID: "parent", callID: "call-review" }, review),
    ])

    expect(pickerRequests).toHaveLength(1)
    expect(pickerRequests[0]?.rows.map((row) => [row.callID, row.agentName, row.preselect?.modelID])).toEqual([
      ["call-build", "builder", "claude-3-5-sonnet"],
      ["call-review", "reviewer", "gpt-4o"],
    ])
    expect(JSON.stringify(pickerRequests)).not.toContain("do not leak")
    expect(build.args.subagent_type).toBe("builder")
    expect(review.args.subagent_type).toBe("reviewer")
    expect(build.args.prompt).toBe("do not leak this prompt")
    expect(review.args.description).toBe("do not leak this description")

    const buildMessage = { message: { model: { providerID: "default", modelID: "default" } }, parts: [] }
    const reviewMessage = { message: { model: { providerID: "default", modelID: "default" } }, parts: [] }
    await Promise.all([
      hooks["chat.message"]!({ sessionID: "child-build", agent: "builder" }, buildMessage as never),
      hooks["chat.message"]!({ sessionID: "child-review", agent: "reviewer" }, reviewMessage as never),
    ])
    expect(buildMessage.message.model).toEqual({ providerID: "anthropic", modelID: "claude-3-5-sonnet" })
    expect(reviewMessage.message.model).toEqual({ providerID: "openai", modelID: "gpt-4o" })

    const taskOutput = { metadata: { sessionID: "child-build", model: { providerID: "default", modelID: "default" } } }
    await hooks["tool.execute.after"]!({ tool: "task", sessionID: "parent", callID: "call-build", args: build.args }, taskOutput as never)
    expect(taskOutput.metadata.model).toEqual({ providerID: "anthropic", modelID: "claude-3-5-sonnet" })
    await hooks.dispose!()

    expect(JSON.stringify(logEntries)).not.toContain("do not leak")
    expect(logEntries).toEqual([expect.objectContaining({ event: "model_dispatch_success", selectedCount: 2 })])
  })

  test("cancel and technical failure preserve original task args and report operator-visible outcomes", async () => {
    const cancelHarness = await createHarness({ kind: "cancel" })
    await expect(cancelHarness.hooks["tool.execute.before"]!({ tool: "task", sessionID: "parent", callID: "call-cancel" }, { args: { subagent_type: "builder" } })).rejects.toThrow(
      "Model selection cancelled",
    )
    expect(cancelHarness.logEntries).toEqual([expect.objectContaining({ code: "MODEL_DISPATCH_CANCELLED" })])

    const failureHarness = await createHarness({ kind: "technical_failure", reason: "picker exited" })
    const output = { args: { subagent_type: "builder", prompt: "still private" } }
    await failureHarness.hooks["tool.execute.before"]!({ tool: "task", sessionID: "parent", callID: "call-fail" }, output)

    expect(output.args).toEqual({ subagent_type: "builder", prompt: "still private" })
    expect(JSON.stringify(failureHarness.logEntries)).not.toContain("still private")
    expect(failureHarness.logEntries).toEqual([expect.objectContaining({ code: "MODEL_DISPATCH_PICKER_FAILED" })])
  })
})

async function createHarness(decision: { kind: "cancel" } | { kind: "technical_failure"; reason: string }) {
  const logEntries: PluginLogEntry[] = []
  const settings: ModelDispatchSettings = {
    ...DEFAULT_SETTINGS,
    dispatch: { ...DEFAULT_SETTINGS.dispatch, enabled: true, batch_ms: 0 },
  }
  const plugin = createModelDispatchPlugin({
    readSettings: async () => ({ settings, warnings: [] }),
    shouldOpenFirstRunSetup: async () => false,
    logger: { info: (entry) => logEntries.push(entry), error: (entry) => logEntries.push(entry) },
    scheduleBatch: (fn) => queueMicrotask(fn),
    launchPicker: async () => decision,
  })
  return { hooks: await plugin({ client: fakeClient(), directory: "C:/scratch" } as never), logEntries }
}

function fakeClient() {
  return {
    app: {
      models: async () => [
        {
          id: "anthropic",
          name: "Anthropic",
          models: [
            { id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet", visible: true, enabled: true },
            { id: "hidden", name: "Hidden", visible: false, enabled: true },
          ],
        },
        { id: "openai", name: "OpenAI", models: [{ id: "gpt-4o", name: "GPT-4o", visible: true, enabled: true }] },
      ],
      agents: async () => [
        { name: "builder", prompt: "build", permissions: { edit: "allow" }, metadata: { model: { providerID: "anthropic", modelID: "claude-3-5-sonnet" } } },
        { name: "reviewer", prompt: "review", permissions: { edit: "deny" }, metadata: { model: { providerID: "openai", modelID: "gpt-4o" } } },
      ],
    },
    session: {
      messages: async () => [{ role: "assistant", metadata: { model: { providerID: "anthropic", modelID: "claude-3-5-sonnet" } } }],
      get: async (options: { path: { id: string } }) => ({
        data: { id: options.path.id, parentID: options.path.id.startsWith("child-") ? "parent" : undefined },
      }),
    },
    tui: {
      showToast: async () => ({ data: true }),
    },
  }
}
