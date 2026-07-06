import { describe, expect, test } from "bun:test"

import { createShadowAgent } from "../src/shadow-agent"

describe("shadow-agent creation", () => {
  test("creates a safe unique internal key while preserving display name", () => {
    const sourceAgent = { name: "Builder", mode: "subagent" as const }

    const first = createShadowAgent(sourceAgent, { providerID: "anthropic", modelID: "claude-3-5-sonnet" })
    const second = createShadowAgent(sourceAgent, { providerID: "openai", modelID: "gpt-4o" })

    expect(first.key).not.toBe(second.key)
    expect(first.key).toMatch(/^model-dispatch-builder-[a-z0-9-]+$/)
    expect(first.definition.name).toBe("Builder")
    expect(second.definition.name).toBe("Builder")
  })

  test("copies latest source fields and overrides selected model", () => {
    const sourceAgent = {
      name: "Reviewer",
      description: "Reviews code",
      prompt: "Be strict",
      mode: "subagent" as const,
      permission: { edit: "ask", bash: "allow" },
      tools: { write: false, read: true },
      options: { temperature: 0.2 },
      model: { providerID: "old-provider", modelID: "old-model" },
      metadata: { owner: "core" },
    }

    const shadow = createShadowAgent(sourceAgent, { providerID: "anthropic", modelID: "claude-3-5-sonnet" })

    expect(shadow.definition).toEqual({
      name: "Reviewer",
      description: "Reviews code",
      prompt: "Be strict",
      mode: "subagent",
      permission: { edit: "ask", bash: "allow" },
      tools: { write: false, read: true },
      options: { temperature: 0.2 },
      model: { providerID: "anthropic", modelID: "claude-3-5-sonnet" },
      metadata: { owner: "core" },
    })
  })

  test("exposes config injection shape for plugin hook wiring", () => {
    const shadow = createShadowAgent({ name: "Plan", mode: "subagent" }, { providerID: "openai", modelID: "gpt-4o" })

    expect(shadow.config).toEqual({
      agent: {
        [shadow.key]: shadow.definition,
      },
    })
  })
})
