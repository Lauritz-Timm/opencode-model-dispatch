import { describe, expect, test } from "bun:test"

import { probeVisibleModels } from "../src/opencode-capabilities"

describe("OpenCode capability probing", () => {
  test("returns enabled visible models in provider/model order", async () => {
    const client = {
      provider: {
        list: async () => [
          {
            id: "anthropic",
            models: [
              { id: "claude-3-5-sonnet", enabled: true, visible: true, name: "Sonnet" },
              { id: "claude-3-haiku", enabled: false, visible: true, name: "Haiku" },
            ],
          },
          {
            id: "openai",
            models: [{ id: "gpt-4o", enabled: true, visible: true, name: "GPT-4o" }],
          },
        ],
      },
    }

    await expect(probeVisibleModels(client)).resolves.toEqual([
      { providerID: "anthropic", modelID: "claude-3-5-sonnet", name: "Sonnet" },
      { providerID: "openai", modelID: "gpt-4o", name: "GPT-4o" },
    ])
  })

  test("rejects models whose visibility cannot be determined", async () => {
    const client = {
      provider: {
        list: async () => [{ id: "anthropic", models: [{ id: "claude-3-5-sonnet", enabled: true }] }],
      },
    }

    await expect(probeVisibleModels(client)).rejects.toThrow("model visibility cannot be determined")
  })
})
