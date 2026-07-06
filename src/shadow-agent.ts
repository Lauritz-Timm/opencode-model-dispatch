export interface ModelSelection {
  providerID: string
  modelID: string
}

export type AgentDefinition = Record<string, unknown> & {
  name: string
  model?: ModelSelection
}

export interface ShadowAgent {
  key: string
  definition: AgentDefinition
  config: {
    agent: Record<string, AgentDefinition>
  }
}

let nextShadowID = 0

export function createShadowAgent(sourceAgent: AgentDefinition, model: ModelSelection): ShadowAgent {
  const key = `model-dispatch-${safeKeyPart(sourceAgent.name)}-${(++nextShadowID).toString(36)}`
  const definition: AgentDefinition = {
    ...cloneRecord(sourceAgent),
    name: sourceAgent.name,
    model: { ...model },
  }

  return {
    key,
    definition,
    config: {
      agent: {
        [key]: definition,
      },
    },
  }
}

function safeKeyPart(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  return normalized || "agent"
}

function cloneRecord<T extends Record<string, unknown>>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
