import { describe, expect, test } from "bun:test"

import {
  MAX_CATALOG_ICON_LENGTH,
  MAX_CATALOG_MODELS,
  MAX_CATALOG_MODELS_PER_PROVIDER,
  MAX_CATALOG_PICKER_PAYLOAD_BYTES,
  MAX_CATALOG_PROVIDERS,
  MAX_CATALOG_ROWS,
  MAX_CATALOG_SERIALIZED_BYTES,
  MAX_CATALOG_STRING_LENGTH,
  MAX_CATALOG_VARIANTS_PER_MODEL,
  shapeModelCatalog,
} from "../src/model-catalog"

const TEST_CATALOG_LIMITS = {
  providers: MAX_CATALOG_PROVIDERS,
  modelsPerProvider: MAX_CATALOG_MODELS_PER_PROVIDER,
  totalModels: MAX_CATALOG_MODELS,
  variantsPerModel: MAX_CATALOG_VARIANTS_PER_MODEL,
  stringLength: MAX_CATALOG_STRING_LENGTH,
  iconLength: MAX_CATALOG_ICON_LENGTH,
  rows: MAX_CATALOG_ROWS,
} as const

describe("model catalog shaping", () => {
  test("adapts the current OpenCode SDK provider, agent, and message response envelopes", async () => {
    const calls: unknown[] = []
    const result = await shapeModelCatalog({
      directory: "/scratch",
      sessionID: "parent",
      tasks: [{ callID: "call-1", args: { subagent_type: "builder" } }],
      client: {
        config: {
          async providers(options) {
            calls.push(options)
            return {
              data: {
                default: { openai: "gpt-5" },
                providers: [
                  {
                    id: "openai",
                    name: "OpenAI",
                    models: {
                      "gpt-5": { id: "gpt-5", name: "GPT-5" },
                      "gpt-old": { id: "gpt-old", name: "GPT Old", status: "deprecated" },
                    },
                  },
                  {
                    id: "opencode",
                    name: "OpenCode",
                    models: {
                      "free-nano": { id: "free-nano", name: "Free Nano" },
                    },
                  },
                ],
              },
            }
          },
        },
        app: {
          async agents(options) {
            calls.push(options)
            return { data: [{ name: "builder", model: { providerID: "openai", modelID: "gpt-5" } }] }
          },
        },
        session: {
          async messages(options) {
            calls.push(options)
            return {
              data: [{
                info: { role: "assistant", providerID: "openai", modelID: "gpt-5" },
                parts: [],
              }],
            }
          },
        },
      },
    })

    expect(result.catalog).toEqual([
      {
        providerID: "openai",
        providerName: "OpenAI",
        icon: "AI",
        models: [{ providerID: "openai", providerName: "OpenAI", modelID: "gpt-5", modelName: "GPT-5", variants: [] }],
      },
    ])
    expect(result.rows[0]?.preselect).toMatchObject({ providerID: "openai", modelID: "gpt-5", source: "agent" })
    expect(calls).toEqual([
      { query: { directory: "/scratch" } },
      { query: { directory: "/scratch" } },
      { path: { id: "parent" }, query: { directory: "/scratch" } },
    ])
  })

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

  test("exposes only provider-advertised effort variants and preserves a supported agent default", async () => {
    const result = await shapeModelCatalog({
      client: fakeClient({
        providers: [{
          id: "openai",
          name: "OpenAI",
          models: [{
            id: "gpt-5",
            name: "GPT-5",
            visible: true,
            variants: {
              default: {},
              low: { reasoningEffort: "low" },
              high: { reasoningEffort: "high" },
              legacy: { disabled: true },
            },
          }],
        }],
        agents: [{
          name: "builder",
          model: { providerID: "openai", modelID: "gpt-5" },
          variant: "high",
        }],
      }),
      sessionID: "parent",
      tasks: [{ callID: "call-1", args: { subagent_type: "builder" } }],
    })

    expect(result.catalog[0]?.models[0]).toEqual({
      providerID: "openai",
      providerName: "OpenAI",
      modelID: "gpt-5",
      modelName: "GPT-5",
      variants: ["low", "high"],
    })
    expect(result.rows[0]?.preselect).toMatchObject({
      providerID: "openai",
      modelID: "gpt-5",
      variant: "high",
      variants: ["low", "high"],
      source: "agent",
    })
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
        preselect: { providerID: "openai", providerName: "OpenAI", modelID: "gpt-4o", modelName: "GPT-4o", variants: [], hidden: false, source: "agent" },
      },
      {
        callID: "without-agent",
        agentName: "reviewer",
        preselect: {
          providerID: "anthropic",
          providerName: "Anthropic",
          modelID: "claude-3-5-sonnet",
          modelName: "Claude 3.5 Sonnet",
          variants: [],
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

  test("keeps prompts and prompt-derived task descriptions out of picker rows", async () => {
    const result = await shapeModelCatalog({
      client: fakeClient({}),
      sessionID: "parent",
      tasks: [{
        callID: "task",
        args: {
          subagent_type: "builder",
          description: "Inspect the dispatch contract",
          prompt: "private task prompt",
        },
      }],
    })

    expect(result.rows).toEqual([{ callID: "task", agentName: "builder" }])
    expect(JSON.stringify(result.rows)).not.toContain("private task prompt")
    expect(JSON.stringify(result.rows)).not.toContain("Inspect the dispatch contract")
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
        models: [{ providerID: "anthropic", providerName: "Anthropic", modelID: "visible", modelName: "Visible", variants: [] }],
      },
    ])
    expect(result.applyToAllCatalog).toEqual(result.catalog)
    expect(result.rows[0]?.preselect).toEqual({
      providerID: "anthropic",
      providerName: "Anthropic",
      modelID: "hidden-agent",
      modelName: "hidden-agent",
      variants: [],
      hidden: true,
      source: "agent",
    })
    expect(result.rows[1]?.preselect).toEqual({
      providerID: "openai",
      providerName: "openai",
      modelID: "hidden-parent",
      modelName: "hidden-parent",
      variants: [],
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

  test("bounds provider, per-provider model, total model, and variant cardinality", async () => {
    const providerBound = await shapeModelCatalog({
      client: fakeClient({
        providers: Array.from({ length: TEST_CATALOG_LIMITS.providers + 2 }, (_, providerIndex) => ({
          id: `provider-${providerIndex}`,
          name: `Provider ${providerIndex}`,
          models: [{ id: `model-${providerIndex}`, name: `Model ${providerIndex}`, visible: true }],
        })),
      }),
      sessionID: "parent",
      tasks: [],
    })

    expect(providerBound.catalog).toHaveLength(TEST_CATALOG_LIMITS.providers)
    expect(providerBound.catalog.at(-1)?.providerID).toBe(`provider-${TEST_CATALOG_LIMITS.providers - 1}`)

    const objectModels = Object.fromEntries(Array.from(
      { length: TEST_CATALOG_LIMITS.modelsPerProvider + 2 },
      (_, modelIndex) => [
        `model-${modelIndex}`,
        {
          id: `model-${modelIndex}`,
          name: `Model ${modelIndex}`,
          visible: true,
          variants: Array.from(
            { length: TEST_CATALOG_LIMITS.variantsPerModel + 2 },
            (_, variantIndex) => `variant-${variantIndex}`,
          ),
        },
      ],
    ))
    const perProviderBound = await shapeModelCatalog({
      client: fakeClient({
        providers: [{ id: "bounded", name: "Bounded", models: objectModels }],
      }),
      sessionID: "parent",
      tasks: [],
    })

    expect(perProviderBound.catalog[0]?.models).toHaveLength(TEST_CATALOG_LIMITS.modelsPerProvider)
    expect(perProviderBound.catalog[0]?.models.at(-1)?.modelID)
      .toBe(`model-${TEST_CATALOG_LIMITS.modelsPerProvider - 1}`)
    expect(perProviderBound.catalog[0]?.models[0]?.variants).toEqual(
      Array.from(
        { length: TEST_CATALOG_LIMITS.variantsPerModel },
        (_, variantIndex) => `variant-${variantIndex}`,
      ),
    )

    const totalBound = await shapeModelCatalog({
      client: fakeClient({
        providers: Array.from({ length: 3 }, (_, providerIndex) => ({
          id: `total-${providerIndex}`,
          name: `Total ${providerIndex}`,
          models: Array.from(
            { length: TEST_CATALOG_LIMITS.modelsPerProvider },
            (_, modelIndex) => ({
              id: `model-${providerIndex}-${modelIndex}`,
              name: `Model ${providerIndex}-${modelIndex}`,
              visible: true,
            }),
          ),
        })),
      }),
      sessionID: "parent",
      tasks: [],
    })

    expect(totalBound.catalog.flatMap((provider) => provider.models))
      .toHaveLength(TEST_CATALOG_LIMITS.totalModels)
    expect(totalBound.catalog.map((provider) => provider.providerID)).toEqual(["total-0", "total-1"])

    const rowBound = await shapeModelCatalog({
      client: fakeClient({}),
      sessionID: "parent",
      tasks: Array.from(
        { length: TEST_CATALOG_LIMITS.rows + 2 },
        (_, rowIndex) => ({ callID: `call-${rowIndex}`, args: { subagent_type: "builder" } }),
      ),
    })

    expect(rowBound.rows).toHaveLength(TEST_CATALOG_LIMITS.rows)
    expect(rowBound.rows.at(-1)?.callID).toBe(`call-${TEST_CATALOG_LIMITS.rows - 1}`)
  })

  test("excludes oversized catalog IDs, names, icons, and variants instead of truncating them", async () => {
    const oversized = "x".repeat(TEST_CATALOG_LIMITS.stringLength + 1)
    const result = await shapeModelCatalog({
      client: fakeClient({
        providers: [
          {
            id: oversized,
            name: "Oversized ID",
            models: [{ id: "model", name: "Model", visible: true }],
          },
          {
            id: "oversized-name",
            name: oversized,
            models: [{ id: "model", name: "Model", visible: true }],
          },
          {
            id: "valid",
            name: "Valid",
            metadata: { icon: "i".repeat(TEST_CATALOG_LIMITS.iconLength + 1) },
            models: [
              { id: oversized, name: "Oversized model ID", visible: true },
              { id: "oversized-model-name", name: oversized, visible: true },
              {
                id: "safe",
                name: "Safe",
                visible: true,
                variants: [oversized, "high"],
              },
            ],
          },
        ],
        agents: [{
          name: oversized,
          model: { providerID: "valid", modelID: "safe" },
        }, {
          name: "invalid-variant",
          model: { providerID: "valid", modelID: "safe" },
          variant: oversized,
        }],
        messages: [{
          role: "assistant",
          metadata: { model: { providerID: oversized, modelID: "safe" } },
        }],
      }),
      sessionID: "parent",
      tasks: [
        { callID: oversized, args: { subagent_type: "builder" } },
        { callID: "call-safe", args: { subagent_type: oversized } },
        { callID: "invalid-variant-row", args: { subagent_type: "invalid-variant" } },
        { callID: "valid-row", args: {} },
      ],
    })

    expect(result.catalog).toEqual([{
      providerID: "valid",
      providerName: "Valid",
      icon: "V",
      models: [{
        providerID: "valid",
        providerName: "Valid",
        modelID: "safe",
        modelName: "Safe",
        variants: ["high"],
      }],
    }])
    expect(result.rows).toEqual([
      { callID: "invalid-variant-row", agentName: "invalid-variant" },
      { callID: "valid-row" },
    ])
    expect(JSON.stringify(result.catalog)).not.toContain(oversized)
  })

  test("rejects control and bidirectional characters in picker-visible identity fields", async () => {
    const result = await shapeModelCatalog({
      client: fakeClient({
        providers: [
          {
            id: "spoofed-provider\u202e",
            name: "OpenAI",
            models: [{ id: "gpt-5", name: "GPT-5", visible: true }],
          },
          {
            id: "spoofed-name",
            name: "OpenAI\u2066",
            models: [{ id: "gpt-5", name: "GPT-5", visible: true }],
          },
          ...["\u200b", "\u2060", "\u00ad", "\ufeff"].map(
            (invisible, index) => ({
              id: `open${invisible}ai-${index}`,
              name: "OpenAI",
              models: [{ id: "gpt-5", name: "GPT-5", visible: true }],
            }),
          ),
          {
            id: "safe",
            name: "Safe",
            models: [
              { id: "safe-model", name: "Safe Model", visible: true },
              {
                id: "spoofed-model",
                name: "GPT-5\ntrusted",
                visible: true,
              },
            ],
          },
        ],
      }),
      sessionID: "parent",
      tasks: [],
    })

    expect(result.catalog).toEqual([{
      providerID: "safe",
      providerName: "Safe",
      icon: "S",
      models: [{
        providerID: "safe",
        providerName: "Safe",
        modelID: "safe-model",
        modelName: "Safe Model",
        variants: [],
      }],
    }])
  })

  test("retains order and exact values for a normal catalog at the supported limits", async () => {
    const variants = Array.from(
      { length: TEST_CATALOG_LIMITS.variantsPerModel },
      (_, variantIndex) => `effort-${variantIndex}`,
    )
    const providerName = "p".repeat(TEST_CATALOG_LIMITS.stringLength)
    const icon = "i".repeat(TEST_CATALOG_LIMITS.iconLength)
    const result = await shapeModelCatalog({
      client: fakeClient({
        providers: [{
          id: "near-limit",
          name: providerName,
          metadata: { icon },
          models: Array.from(
            { length: TEST_CATALOG_LIMITS.modelsPerProvider },
            (_, modelIndex) => ({
              id: `model-${modelIndex}`,
              name: `Model ${modelIndex}`,
              visible: true,
              variants,
            }),
          ),
        }],
      }),
      sessionID: "parent",
      tasks: [],
    })

    expect(result.catalog[0]?.providerName).toBe(providerName)
    expect(result.catalog[0]?.icon).toBe(icon)
    expect(result.catalog[0]?.models).toHaveLength(TEST_CATALOG_LIMITS.modelsPerProvider)
    expect(result.catalog[0]?.models.map((model) => model.modelID)).toEqual(
      Array.from(
        { length: TEST_CATALOG_LIMITS.modelsPerProvider },
        (_, modelIndex) => `model-${modelIndex}`,
      ),
    )
    expect(result.catalog[0]?.models.at(-1)?.variants).toEqual(variants)
  })

  test("keeps a worst-case accepted catalog and bounded rows below the native 4 MiB line cap", async () => {
    const maximumString = "\u0800".repeat(TEST_CATALOG_LIMITS.stringLength)
    const maximumIcon = "\u0800".repeat(TEST_CATALOG_LIMITS.iconLength)
    const maximumVariants = Array.from(
      { length: TEST_CATALOG_LIMITS.variantsPerModel },
      () => maximumString,
    )
    const result = await shapeModelCatalog({
      client: fakeClient({
        providers: [{
          id: maximumString,
          name: maximumString,
          metadata: { icon: maximumIcon },
          models: Array.from(
            { length: TEST_CATALOG_LIMITS.modelsPerProvider },
            () => ({
              id: maximumString,
              name: maximumString,
              visible: true,
              variants: maximumVariants,
            }),
          ),
        }],
        agents: [{
          name: maximumString,
          model: { providerID: maximumString, modelID: maximumString },
          variant: maximumString,
        }],
      }),
      sessionID: "parent",
      tasks: Array.from(
        { length: TEST_CATALOG_LIMITS.rows },
        () => ({ callID: maximumString, args: { subagent_type: maximumString } }),
      ),
    })

    const encoder = new TextEncoder()
    const catalogBytes = encoder.encode(JSON.stringify(result.catalog)).byteLength
    const payloadBytes = encoder.encode(JSON.stringify(result)).byteLength
    const startLineBytes = encoder.encode(JSON.stringify({
      jsonrpc: "2.0",
      method: "start",
      params: result,
    })).byteLength

    expect(result.catalog.length).toBeGreaterThan(0)
    expect(result.rows).toHaveLength(TEST_CATALOG_LIMITS.rows)
    expect(result.rows[0]?.agentName).toBe(maximumString)
    expect(catalogBytes).toBeLessThanOrEqual(MAX_CATALOG_SERIALIZED_BYTES)
    expect(payloadBytes).toBeLessThanOrEqual(MAX_CATALOG_PICKER_PAYLOAD_BYTES)
    expect(startLineBytes).toBeLessThan(4 * 1024 * 1024)
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
