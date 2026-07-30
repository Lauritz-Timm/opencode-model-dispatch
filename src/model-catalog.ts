export interface ModelSelection {
  providerID: string
  modelID: string
  variant?: string
}

export interface CatalogModel extends ModelSelection {
  providerName: string
  modelName: string
  variants: string[]
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
  description?: string
  preselect?: CatalogModel & { hidden: boolean; source: "agent" | "parent" }
}

export interface ShapeModelCatalogRequest {
  client: ModelCatalogClient
  sessionID: string
  tasks: Array<{ callID: string; args: Record<string, unknown> }>
  directory?: string
}

export interface ShapeModelCatalogResult {
  catalog: CatalogProvider[]
  applyToAllCatalog: CatalogProvider[]
  rows: TaskCatalogRow[]
}

export interface ModelCatalogClient {
  config?: {
    get?(options?: unknown): Promise<unknown>
    providers?(options?: unknown): Promise<unknown>
  }
  app?: {
    models?: () => Promise<unknown>
    agents?: (options?: unknown) => Promise<unknown>
  }
  provider?: {
    list(options?: unknown): Promise<unknown>
  }
  session: {
    messages(options: unknown): Promise<unknown>
    get?: (options: unknown) => Promise<unknown>
  }
  tui?: {
    showToast(options: unknown): Promise<unknown>
  }
}

export const MAX_CATALOG_PROVIDERS = 64
export const MAX_CATALOG_MODELS_PER_PROVIDER = 512
export const MAX_CATALOG_MODELS = 1024
export const MAX_CATALOG_VARIANTS_PER_MODEL = 16
export const MAX_CATALOG_STRING_LENGTH = 256
export const MAX_CATALOG_ICON_LENGTH = 32
export const MAX_CATALOG_ROWS = 64
export const MAX_CATALOG_SERIALIZED_BYTES = 640 * 1024
export const MAX_CATALOG_PICKER_PAYLOAD_BYTES = 3 * 1024 * 1024

const PROVIDER_ICONS: Record<string, string> = {
  anthropic: "A",
  openai: "AI",
  google: "G",
  github: "GH",
}
const PROVIDER_CONNECTION_STATE = Symbol("providerConnectionState")

export async function shapeModelCatalog(request: ShapeModelCatalogRequest): Promise<ShapeModelCatalogResult> {
  const [providers, agents, messages] = await Promise.all([
    listModels(request.client, request.directory),
    listAgents(request.client, request.directory),
    listMessages(request.client, request.sessionID, request.directory),
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
  visitBoundedValues(agents, MAX_CATALOG_ROWS, (agent) => {
    const nameResult = readCatalogName(agent, ["name"])
    if (!nameResult.valid) return
    const directVariant = readCatalogName(agent, ["variant"])
    if (!directVariant.valid) return
    const metadataVariant = directVariant.value === undefined
      ? readCatalogName(agent, ["metadata", "variant"])
      : directVariant
    if (!metadataVariant.valid) return
    const baseModel = readModelSelection(readPath(agent, ["model"])) ?? readModelSelection(readPath(agent, ["metadata", "model"]))
    const agentVariant = metadataVariant.value
    const model = baseModel
      ? { ...baseModel, ...(agentVariant ? { variant: agentVariant } : {}) }
      : undefined
    if (nameResult.value && model) agentModels.set(nameResult.value, model)
  })

  const parentModel = findLatestAssistantModel(messages)
  const rows: TaskCatalogRow[] = []
  visitBoundedValues(request.tasks, MAX_CATALOG_ROWS, (task) => {
    if (!isRecord(task) || !isCatalogStringValue(task.callID) || !isRecord(task.args)) return
    const agentNameResult = readCatalogName(task.args, ["subagent_type"])
    if (!agentNameResult.valid) return
    const agentName = agentNameResult.value
    const agentModel = agentName ? agentModels.get(agentName) : undefined
    const preselect = agentModel
      ? resolvePreselect(agentModel, "agent", visibleModels, providerNames)
      : parentModel
        ? resolvePreselect(parentModel, "parent", visibleModels, providerNames)
        : undefined

    rows.push({
      callID: task.callID,
      ...(agentName ? { agentName } : {}),
      ...(preselect ? { preselect } : {}),
    })
  })

  return boundShapeResult(catalog, rows)
}

function shapeVisibleCatalog(providers: unknown[]): CatalogProvider[] {
  const catalog: CatalogProvider[] = []
  let totalModelsInspected = 0
  let catalogBytes = 2

  visitBoundedValues(providers, MAX_CATALOG_PROVIDERS, (provider) => {
    if (totalModelsInspected >= MAX_CATALOG_MODELS) return
    if (!isRecord(provider)) return
    const connectionState = readProviderConnectionState(provider)
    if (connectionState === false) return
    const providerID = readCatalogString(provider, ["id"])
    if (!providerID) return
    const providerNameResult = readCatalogName(provider, ["name"])
    if (!providerNameResult.valid) return
    const providerName = providerNameResult.value ?? providerID
    const icon = providerIcon(providerID, providerName, provider)
    const visibleModels: CatalogModel[] = []
    let providerBytes = jsonByteLength({ providerID, providerName, icon, models: [] })

    const remainingModels = Math.min(
      MAX_CATALOG_MODELS_PER_PROVIDER,
      MAX_CATALOG_MODELS - totalModelsInspected,
    )
    totalModelsInspected += visitBoundedValues(provider.models, remainingModels, (model) => {
      if (!isRecord(model)) return
      const modelID = readCatalogString(model, ["id"])
      if (
        !modelID ||
        (connectionState !== true && (model.visible === false || model.enabled === false)) ||
        model.status === "deprecated" ||
        (providerID === "opencode" && modelID.includes("-nano"))
      ) return
      const modelNameResult = readCatalogName(model, ["name"])
      if (!modelNameResult.valid) return
      const catalogModel: CatalogModel = {
        providerID,
        providerName,
        modelID,
        modelName: modelNameResult.value ?? modelID,
        variants: readModelVariants(model),
      }
      const additionalBytes = jsonByteLength(catalogModel) + (visibleModels.length > 0 ? 1 : 0)
      const providerSeparatorBytes = catalog.length > 0 ? 1 : 0
      if (
        catalogBytes + providerSeparatorBytes + providerBytes + additionalBytes >
        MAX_CATALOG_SERIALIZED_BYTES
      ) return
      visibleModels.push(catalogModel)
      providerBytes += additionalBytes
    })

    if (visibleModels.length > 0) {
      if (catalog.length > 0) catalogBytes++
      catalogBytes += providerBytes
      catalog.push({
        providerID,
        providerName,
        icon,
        models: visibleModels,
      })
    }
  })

  return catalog
}

function findLatestAssistantModel(messages: unknown[]): ModelSelection | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const entry = messages[index]
    const message = isRecord(entry) && isRecord(entry.info) ? entry.info : entry
    if (readString(message, ["role"]) !== "assistant") continue
    const model =
      readModelSelection(readPath(message, ["metadata", "model"])) ??
      readModelSelection({
        providerID: readString(message, ["providerID"]),
        modelID: readString(message, ["modelID"]),
        variant: readString(message, ["variant"]),
      })
    if (model) return model
  }
  return undefined
}

async function listModels(client: ModelCatalogClient, directory?: string): Promise<unknown[]> {
  if (client.config?.providers) {
    const response = await client.config.providers({ query: { directory } })
    const data = responseData(response)
    return isRecord(data) && Array.isArray(data.providers) ? data.providers : []
  }

  if (client.provider?.list) {
    const response = await client.provider.list({ query: { directory } })
    const data = responseData(response)
    if (!isRecord(data) || !Array.isArray(data.all)) return []
    const connected = new Set<string>()
    if (Array.isArray(data.connected)) {
      visitBoundedValues(data.connected, MAX_CATALOG_PROVIDERS, (providerID) => {
        if (typeof providerID === "string" && isCatalogString(providerID)) connected.add(providerID)
      })
    }
    const providers: unknown[] = []
    visitBoundedValues(data.all, MAX_CATALOG_PROVIDERS, (provider) => {
      if (!isRecord(provider)) return
      const normalized = {
        id: provider.id,
        name: provider.name,
        metadata: provider.metadata,
        models: provider.models,
        [PROVIDER_CONNECTION_STATE]: connected.has(readCatalogString(provider, ["id"]) ?? ""),
      }
      providers.push(normalized)
    })
    return providers
  }

  const response = await client.app?.models?.()
  const data = responseData(response)
  return Array.isArray(data) ? data : []
}

async function listAgents(client: ModelCatalogClient, directory?: string): Promise<unknown[]> {
  const response = await client.app?.agents?.({ query: { directory } })
  const data = responseData(response)
  return Array.isArray(data) ? data : []
}

async function listMessages(client: ModelCatalogClient, sessionID: string, directory?: string): Promise<unknown[]> {
  let response: unknown
  try {
    response = await client.session.messages({ path: { id: sessionID }, query: { directory } })
  } catch {
    response = await client.session.messages(sessionID)
  }
  const data = responseData(response)
  return Array.isArray(data) ? data : []
}

function responseData(value: unknown): unknown {
  if (isRecord(value) && "data" in value) return value.data
  return value
}

function resolvePreselect(
  selection: ModelSelection,
  source: "agent" | "parent",
  visibleModels: Map<string, CatalogModel>,
  providerNames: Map<string, string>,
): CatalogModel & { hidden: boolean; source: "agent" | "parent" } {
  const visible = visibleModels.get(modelKey(selection))
  if (visible) {
    return {
      ...visible,
      ...(selection.variant && visible.variants.includes(selection.variant) ? { variant: selection.variant } : {}),
      hidden: false,
      source,
    }
  }

  const providerName = providerNames.get(selection.providerID) ?? selection.providerID
  return {
    providerID: selection.providerID,
    providerName,
    modelID: selection.modelID,
    modelName: selection.modelID,
    variants: selection.variant ? [selection.variant] : [],
    ...(selection.variant ? { variant: selection.variant } : {}),
    hidden: true,
    source,
  }
}

function providerIcon(providerID: string, providerName: string, provider: Record<string, unknown>): string {
  return readCatalogString(provider, ["metadata", "icon"], MAX_CATALOG_ICON_LENGTH) ??
    PROVIDER_ICONS[providerID] ??
    providerName.slice(0, 1).toUpperCase()
}

function readModelSelection(value: unknown): ModelSelection | undefined {
  const providerID = readCatalogString(value, ["providerID"])
  const modelID = readCatalogString(value, ["modelID"])
  if (!providerID || !modelID) return undefined
  const variant = readCatalogName(value, ["variant"])
  if (!variant.valid) return undefined
  return { providerID, modelID, ...(variant.value ? { variant: variant.value } : {}) }
}

function readModelVariants(model: Record<string, unknown>): string[] {
  const variants: string[] = []
  if (Array.isArray(model.variants)) {
    visitBoundedValues(model.variants, MAX_CATALOG_VARIANTS_PER_MODEL, (variant) => {
      if (typeof variant === "string" && isCatalogString(variant) && variant !== "default") {
        variants.push(variant)
      }
    })
    return variants
  }
  if (!isRecord(model.variants)) return []

  let inspected = 0
  for (const variant in model.variants) {
    if (inspected >= MAX_CATALOG_VARIANTS_PER_MODEL) break
    inspected++
    if (!Object.hasOwn(model.variants, variant)) continue
    if (!isCatalogString(variant) || variant === "default") continue
    const options = model.variants[variant]
    if (isRecord(options) && options.disabled === true) continue
    variants.push(variant)
  }
  return variants
}

function modelKey(selection: ModelSelection): string {
  return JSON.stringify([selection.providerID, selection.modelID])
}

function boundShapeResult(catalog: CatalogProvider[], rows: TaskCatalogRow[]): ShapeModelCatalogResult {
  const result = { catalog, applyToAllCatalog: catalog, rows }
  if (jsonByteLength(result) <= MAX_CATALOG_PICKER_PAYLOAD_BYTES) return result

  const rowsWithoutPreselection = rows.map((row) => ({
    callID: row.callID,
    ...(row.agentName ? { agentName: row.agentName } : {}),
  }))
  const withoutPreselection = {
    catalog,
    applyToAllCatalog: catalog,
    rows: rowsWithoutPreselection,
  }
  if (jsonByteLength(withoutPreselection) <= MAX_CATALOG_PICKER_PAYLOAD_BYTES) {
    return withoutPreselection
  }

  return {
    catalog: [],
    applyToAllCatalog: [],
    rows: rowsWithoutPreselection,
  }
}

function readString(value: unknown, path: string[]): string | undefined {
  const found = readPath(value, path)
  return typeof found === "string" && found.length > 0 ? found : undefined
}

function readCatalogString(
  value: unknown,
  path: string[],
  maxLength = MAX_CATALOG_STRING_LENGTH,
): string | undefined {
  const found = readPath(value, path)
  return typeof found === "string" && isCatalogString(found, maxLength)
    ? found
    : undefined
}

function readCatalogName(
  value: unknown,
  path: string[],
): { valid: true; value?: string } | { valid: false } {
  const found = readPath(value, path)
  if (found === undefined || found === null || found === "") return { valid: true }
  if (typeof found !== "string" || !isCatalogDisplayName(found)) {
    return { valid: false }
  }
  return { valid: true, value: found }
}

function isCatalogString(
  value: string,
  maxLength = MAX_CATALOG_STRING_LENGTH,
): boolean {
  return (
    value.length > 0
    && value.length <= maxLength
    && !UNSAFE_IDENTIFIER_CHARACTER_PATTERN.test(value)
  )
}

function isCatalogStringValue(value: unknown): value is string {
  return typeof value === "string" && isCatalogString(value)
}

function isCatalogDisplayName(value: string): boolean {
  return (
    value.length > 0
    && value.length <= MAX_CATALOG_STRING_LENGTH
    && !UNSAFE_DISPLAY_CHARACTER_PATTERN.test(value)
  )
}

const UNSAFE_DISPLAY_CHARACTER_PATTERN =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u
const UNSAFE_IDENTIFIER_CHARACTER_PATTERN =
  /[\p{Cc}\p{Cf}\p{Cs}\p{Z}\p{Default_Ignorable_Code_Point}]/u

function jsonByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

function readProviderConnectionState(provider: Record<string, unknown>): boolean | undefined {
  const state = (provider as Record<PropertyKey, unknown>)[PROVIDER_CONNECTION_STATE]
  return typeof state === "boolean" ? state : undefined
}

function visitBoundedValues(
  value: unknown,
  limit: number,
  visit: (entry: unknown) => void,
): number {
  if (limit <= 0) return 0
  if (Array.isArray(value)) {
    const length = Math.min(value.length, limit)
    for (let index = 0; index < length; index++) visit(value[index])
    return length
  }
  if (!isRecord(value)) return 0

  let inspected = 0
  for (const key in value) {
    if (inspected >= limit) break
    inspected++
    if (Object.hasOwn(value, key)) visit(value[key])
  }
  return inspected
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
