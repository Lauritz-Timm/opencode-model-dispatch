import { describe, expect, test } from "bun:test"

import { shapeModelCatalog } from "../src/model-catalog"

describe("model catalog shaping", () => {
  test("builds provider-grouped catalog from visible models and preserves provider/model order", async () => {
    const result = await shapeModelCatalog({
      client: fakeClient({
        providers: [
          {
            id: "anthropic",
            name: "Anthropic",
            models: [
              { id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet", visible: true },
              { id: "claude-3-opus", name: "Claude 3 Opus", visible: false },
            ],
          },
          {
            id: "openai",
            name: "OpenAI",
            models: [
              { id: "gpt-4o", name: "GPT-4o", visible: true },
              { id: "gpt-4o-mini", name: "GPT-4o mini", visible: true },
            ],
          },
        ],
      }),
      sessionID: "parent",
      tasks: [],
    })

    expect(result.catalog.map((provider) => provider.providerID)).toEqual(["anthropic", "openai"])
    expect(result.catalog[0]?.models.map((model) => model.modelID)).toEqual(["claude-3-5-sonnet"])
    expect(result.catalog[1]?.models.map((model) => model.modelID)).toEqual(["gpt-4o", "gpt-4o-mini"])
  })

  test("excludes disabled models from the picker catalog", async () => {
    const result = await shapeModelCatalog({
      client: fakeClient({
        providers: [
          {
            id: "anthropic",
            name: "Anthropic",
            models: [
              { id: "enabled", name: "Enabled", visible: true, enabled: true },
              { id: "disabled", name: "Disabled", visible: true, enabled: false },
            ],
          },
        ],
      }),
      sessionID: "parent",
      tasks: [],
    })

    expect(result.catalog[0]?.models.map((model) => model.modelID)).toEqual(["enabled"])
  })

  test("preselects agent default model before latest parent assistant model", async () => {
    const result = await shapeModelCatalog({
      client: fakeClient({
        providers: [
          { id: "anthropic", name: "Anthropic", models: [{ id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet", visible: true }] },
          { id: "openai", name: "OpenAI", models: [{ id: "gpt-4o", name: "GPT-4o", visible: true }] },
        ],
        agents: [{ name: "builder", metadata: { model: { providerID: "openai", modelID: "gpt-4o" } } }],
        messages: [
          { role: "assistant", metadata: { model: { providerID: "anthropic", modelID: "claude-3-5-sonnet" } } },
          { role: "user" },
        ],
      }),
      sessionID: "parent",
      tasks: [
        { callID: "with-agent", args: { subagent_type: "builder" } },
        { callID: "without-agent", args: { subagent_type: "reviewer" } },
      ],
    })

    expect(result.rows).toEqual([
      {
        callID: "with-agent",
        agentName: "builder",
        preselect: { providerID: "openai", providerName: "OpenAI", modelID: "gpt-4o", modelName: "GPT-4o", hidden: false, source: "agent" },
      },
      {
        callID: "without-agent",
        agentName: "reviewer",
        preselect: {
          providerID: "anthropic",
          providerName: "Anthropic",
          modelID: "claude-3-5-sonnet",
          modelName: "Claude 3.5 Sonnet",
          hidden: false,
          source: "parent",
        },
      },
    ])
  })

  test("uses the latest assistant message when deriving parent current model", async () => {
    const result = await shapeModelCatalog({
      client: fakeClient({
        providers: [
          { id: "anthropic", name: "Anthropic", models: [{ id: "old", name: "Old", visible: true }] },
          { id: "openai", name: "OpenAI", models: [{ id: "new", name: "New", visible: true }] },
        ],
        messages: [
          { role: "assistant", metadata: { model: { providerID: "anthropic", modelID: "old" } } },
          { role: "assistant", metadata: { model: { providerID: "openai", modelID: "new" } } },
        ],
      }),
      sessionID: "parent",
      tasks: [{ callID: "task", args: {} }],
    })

    expect(result.rows[0]?.preselect).toMatchObject({ providerID: "openai", modelID: "new", source: "parent" })
  })

  test("shows hidden configured or current preselect only on the affected row", async () => {
    const result = await shapeModelCatalog({
      client: fakeClient({
        providers: [{ id: "anthropic", name: "Anthropic", models: [{ id: "visible", name: "Visible", visible: true }] }],
        agents: [{ name: "builder", metadata: { model: { providerID: "anthropic", modelID: "hidden-agent" } } }],
        messages: [{ role: "assistant", metadata: { model: { providerID: "openai", modelID: "hidden-parent" } } }],
      }),
      sessionID: "parent",
      tasks: [
        { callID: "agent-row", args: { subagent_type: "builder" } },
        { callID: "parent-row", args: { subagent_type: "reviewer" } },
      ],
    })

    expect(result.catalog).toEqual([
      {
        providerID: "anthropic",
        providerName: "Anthropic",
        icon: "A",
        models: [{ providerID: "anthropic", providerName: "Anthropic", modelID: "visible", modelName: "Visible" }],
      },
    ])
    expect(result.applyToAllCatalog).toEqual(result.catalog)
    expect(result.rows[0]?.preselect).toEqual({
      providerID: "anthropic",
      providerName: "Anthropic",
      modelID: "hidden-agent",
      modelName: "hidden-agent",
      hidden: true,
      source: "agent",
    })
    expect(result.rows[1]?.preselect).toEqual({
      providerID: "openai",
      providerName: "openai",
      modelID: "hidden-parent",
      modelName: "hidden-parent",
      hidden: true,
      source: "parent",
    })
  })

  test("resolves provider icons from metadata, bundled map, then provider initial", async () => {
    const result = await shapeModelCatalog({
      client: fakeClient({
        providers: [
          { id: "custom", name: "Custom", metadata: { icon: "C!" }, models: [{ id: "one", name: "One", visible: true }] },
          { id: "openai", name: "OpenAI", models: [{ id: "gpt", name: "GPT", visible: true }] },
          { id: "local", name: "Local", models: [{ id: "tiny", name: "Tiny", visible: true }] },
        ],
      }),
      sessionID: "parent",
      tasks: [],
    })

    expect(result.catalog.map((provider) => provider.icon)).toEqual(["C!", "AI", "L"])
  })
})

function fakeClient(options: {
  providers?: unknown[]
  agents?: unknown[]
  messages?: unknown[]
}) {
  return {
    app: {
      models: async () => options.providers ?? [],
      agents: async () => options.agents ?? [],
    },
    session: {
      messages: async (_sessionID: string) => options.messages ?? [],
    },
  }
}
