export interface VisibleModel {
  providerID: string
  modelID: string
  name?: string
}

interface OpenCodeClientLike {
  provider?: {
    list?: () => Promise<unknown> | unknown
  }
}

export async function probeVisibleModels(client: OpenCodeClientLike): Promise<VisibleModel[]> {
  const providers = await client.provider?.list?.()
  if (!Array.isArray(providers)) throw new Error("OpenCode provider list response is not an array")

  const visibleModels: VisibleModel[] = []
  for (const provider of providers) {
    if (!isRecord(provider) || typeof provider.id !== "string" || !Array.isArray(provider.models)) {
      throw new Error("OpenCode provider response is missing provider/model information")
    }

    for (const model of provider.models) {
      if (!isRecord(model) || typeof model.id !== "string") {
        throw new Error("OpenCode model response is missing model information")
      }
      if (typeof model.enabled !== "boolean" || typeof model.visible !== "boolean") {
        throw new Error("OpenCode model visibility cannot be determined")
      }
      if (!model.enabled || !model.visible) continue

      visibleModels.push({
        providerID: provider.id,
        modelID: model.id,
        ...(typeof model.name === "string" ? { name: model.name } : {}),
      })
    }
  }

  return visibleModels
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
