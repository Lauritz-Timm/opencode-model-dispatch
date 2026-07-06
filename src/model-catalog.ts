export interface ModelSelection {
  providerID: string
  modelID: string
}

export interface CatalogModel extends ModelSelection {
  providerName: string
  modelName: string
}

export interface CatalogProvider {
  providerID: string
  providerName: string
  icon: string
  models: CatalogModel[]
}

export interface TaskCatalogRow {
  callID: string
  agentName?: string
  preselect?: CatalogModel & { hidden: boolean; source: "agent" | "parent" }
}

export interface ShapeModelCatalogRequest {
  client: ModelCatalogClient
  sessionID: string
  tasks: Array<{ callID: string; args: Record<string, unknown> }>
}

export interface ShapeModelCatalogResult {
  catalog: CatalogProvider[]
  applyToAllCatalog: CatalogProvider[]
  rows: TaskCatalogRow[]
}

export interface ModelCatalogClient {
  app: {
    models(): Promise<unknown[]>
    agents(): Promise<unknown[]>
  }
  session: {
    messages(sessionID: string): Promise<unknown[]>
  }
}

const PROVIDER_ICONS: Record<string, string> = {
  anthropic: "A",
  openai: "AI",
  google: "G",
  github: "GH",
}

export async function shapeModelCatalog(request: ShapeModelCatalogRequest): Promise<ShapeModelCatalogResult> {
  const [providers, agents, messages] = await Promise.all([
    request.client.app.models(),
    request.client.app.agents(),
    request.client.session.messages(request.sessionID),
  ])

  const catalog = shapeVisibleCatalog(providers)
  const visibleModels = new Map<string, CatalogModel>()
  const providerNames = new Map<string, string>()

  for (const provider of catalog) {
    providerNames.set(provider.providerID, provider.providerName)
    for (const model of provider.models) {
      visibleModels.set(modelKey(model), model)
    }
  }

  const agentModels = new Map<string, ModelSelection>()
  for (const agent of agents) {
    const name = readString(agent, ["name"])
    const model = readModelSelection(readPath(agent, ["metadata", "model"]))
    if (name && model) agentModels.set(name, model)
  }

  const parentModel = findLatestAssistantModel(messages)
  const rows = request.tasks.map((task): TaskCatalogRow => {
    const agentName = readString(task.args, ["subagent_type"])
    const agentModel = agentName ? agentModels.get(agentName) : undefined
    const preselect = agentModel
      ? resolvePreselect(agentModel, "agent", visibleModels, providerNames)
      : parentModel
        ? resolvePreselect(parentModel, "parent", visibleModels, providerNames)
        : undefined

    return {
      callID: task.callID,
      ...(agentName ? { agentName } : {}),
      ...(preselect ? { preselect } : {}),
    }
  })

  return { catalog, applyToAllCatalog: catalog, rows }
}

function shapeVisibleCatalog(providers: unknown[]): CatalogProvider[] {
  const catalog: CatalogProvider[] = []

  for (const provider of providers) {
    if (!isRecord(provider)) continue
    const providerID = readString(provider, ["id"])
    if (!providerID) continue
    const providerName = readString(provider, ["name"]) ?? providerID
    const models = Array.isArray(provider.models) ? provider.models : []
    const visibleModels: CatalogModel[] = []

    for (const model of models) {
      if (!isRecord(model) || model.visible === false || model.enabled === false) continue
      const modelID = readString(model, ["id"])
      if (!modelID) continue
      visibleModels.push({
        providerID,
        providerName,
        modelID,
        modelName: readString(model, ["name"]) ?? modelID,
      })
    }

    if (visibleModels.length > 0) {
      catalog.push({
        providerID,
        providerName,
        icon: providerIcon(providerID, providerName, provider),
        models: visibleModels,
      })
    }
  }

  return catalog
}

function findLatestAssistantModel(messages: unknown[]): ModelSelection | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (readString(message, ["role"]) !== "assistant") continue
    const model = readModelSelection(readPath(message, ["metadata", "model"]))
    if (model) return model
  }
  return undefined
}

function resolvePreselect(
  selection: ModelSelection,
  source: "agent" | "parent",
  visibleModels: Map<string, CatalogModel>,
  providerNames: Map<string, string>,
): CatalogModel & { hidden: boolean; source: "agent" | "parent" } {
  const visible = visibleModels.get(modelKey(selection))
  if (visible) return { ...visible, hidden: false, source }

  const providerName = providerNames.get(selection.providerID) ?? selection.providerID
  return {
    providerID: selection.providerID,
    providerName,
    modelID: selection.modelID,
    modelName: selection.modelID,
    hidden: true,
    source,
  }
}

function providerIcon(providerID: string, providerName: string, provider: Record<string, unknown>): string {
  return readString(provider, ["metadata", "icon"]) ?? PROVIDER_ICONS[providerID] ?? providerName.slice(0, 1).toUpperCase()
}

function readModelSelection(value: unknown): ModelSelection | undefined {
  const providerID = readString(value, ["providerID"])
  const modelID = readString(value, ["modelID"])
  if (!providerID || !modelID) return undefined
  return { providerID, modelID }
}

function modelKey(selection: ModelSelection): string {
  return `${selection.providerID}:${selection.modelID}`
}

function readString(value: unknown, path: string[]): string | undefined {
  const found = readPath(value, path)
  return typeof found === "string" && found.length > 0 ? found : undefined
}

function readPath(value: unknown, path: string[]): unknown {
  let current = value
  for (const part of path) {
    if (!isRecord(current)) return undefined
    current = current[part]
  }
  return current
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
