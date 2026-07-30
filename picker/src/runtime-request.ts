import {
  modelsForTaskInput,
  type ModelSelectionInput,
  type PickerModel,
  type PickerTask,
} from "./model-selection-reducer"
import {
  MAX_PICKER_DESCRIPTION_LENGTH,
  MAX_PICKER_ID_LENGTH,
  MAX_PICKER_MODELS_PER_CATALOG,
  MAX_PICKER_MODELS_PER_PROVIDER,
  MAX_PICKER_NAME_LENGTH,
  MAX_PICKER_PROVIDERS_PER_CATALOG,
  MAX_PICKER_TASKS,
  MAX_PICKER_VARIANT_LENGTH,
  MAX_PICKER_VARIANTS_PER_MODEL,
} from "./runtime-limits"
import type { ConfigScope, SetupSettings } from "./setup-reducer"

export interface PickerThemeHint {
  themeID?: string
  colorScheme?: string
}

export interface PickerModelSelectionInput extends ModelSelectionInput {}

export interface PickerRequestCatalogModel {
  providerID: string
  providerName: string
  modelID: string
  modelName: string
  variants: string[]
}

export interface PickerRequestCatalogProvider {
  providerID: string
  providerName: string
  models: PickerRequestCatalogModel[]
}

export interface PickerRequestRow {
  callID: string
  agentName?: string
  description?: string
  preselect?: PickerRequestCatalogModel & { variant?: string; hidden: boolean; source: "agent" | "parent" }
}

export interface BackendPickerRequestInput {
  catalog: PickerRequestCatalogProvider[]
  applyToAllCatalog: PickerRequestCatalogProvider[]
  rows: PickerRequestRow[]
}

export interface PickerSetupInput {
  settings: SetupSettings
  scope?: ConfigScope
  projectIsGitRepo?: boolean
  projectConfigIgnored?: boolean
}

export interface PickerRuntimeRequest {
  theme?: PickerThemeHint
  modelSelection?: PickerModelSelectionInput
  setup?: PickerSetupInput
}

export interface PickerRuntimeData extends PickerRuntimeRequest {
  modelSelection?: PickerModelSelectionInput
  setup?: PickerSetupInput
}

export interface PickerPreviewFixture extends PickerRuntimeData {
  theme: PickerThemeHint
  modelSelection: PickerModelSelectionInput
  setup: PickerSetupInput
}

const RUNTIME_REQUEST_KEY = "__OPENCODE_MODEL_DISPATCH_PICKER_REQUEST__"

export function getPickerRuntimeRequest(): PickerRuntimeRequest | undefined {
  if (typeof globalThis === "undefined") return undefined
  const value = (globalThis as Record<string, unknown>)[RUNTIME_REQUEST_KEY]
  return readRuntimeRequest(value)
}

export function resolvePickerThemeHint(params: URLSearchParams, runtimeRequest?: PickerRuntimeRequest, fixtureTheme?: PickerThemeHint): PickerThemeHint {
  return {
    themeID: params.get("themeID") ?? runtimeRequest?.theme?.themeID ?? fixtureTheme?.themeID,
    colorScheme: params.get("colorScheme") ?? runtimeRequest?.theme?.colorScheme ?? fixtureTheme?.colorScheme,
  }
}

export function resolvePickerRuntimeData(params: URLSearchParams, runtimeRequest?: PickerRuntimeRequest, previewFixture?: PickerPreviewFixture): PickerRuntimeData | undefined {
  if (params.get("preview") === "1") return previewFixture
  if (!runtimeRequest?.modelSelection && !runtimeRequest?.setup) return undefined
  return runtimeRequest
}

export function modelSelectionInputFromPickerRequest(request: BackendPickerRequestInput): PickerModelSelectionInput {
  const rowOnlyModels = Object.fromEntries(
    request.rows
      .filter((row) => row.preselect?.hidden)
      .map((row) => [row.callID, [pickerModel(row.preselect!)]]),
  )

  return {
    tasks: request.rows.map((row) => ({
      id: row.callID,
      agentType: row.agentName ?? "task",
      description: "",
    })),
    models: flattenCatalog(request.catalog),
    applyToAllModels: flattenCatalog(request.applyToAllCatalog),
    preselectedModels: Object.fromEntries(
      request.rows
        .filter((row) => row.preselect)
        .map((row) => {
          const preselect = row.preselect!
          const variants = readVariants(preselect.variants)
          return [
            row.callID,
            {
              providerID: preselect.providerID,
              modelID: preselect.modelID,
              ...(preselect.variant && variants.includes(preselect.variant) ? { variant: preselect.variant } : {}),
            },
          ]
        }),
    ),
    ...(Object.keys(rowOnlyModels).length > 0 ? { rowOnlyModels } : {}),
  }
}

export function boundedBackendPickerRequestInput(value: unknown): BackendPickerRequestInput | undefined {
  if (!isRecord(value)) return undefined
  if (!isBoundedCatalog(value.catalog) || !isBoundedCatalog(value.applyToAllCatalog)) return undefined
  if (!Array.isArray(value.rows) || value.rows.length > MAX_PICKER_TASKS || !value.rows.every(isBoundedRequestRow)) return undefined

  return {
    catalog: value.catalog,
    applyToAllCatalog: value.applyToAllCatalog,
    rows: value.rows,
  }
}

export function modelsForTaskRow(input: PickerModelSelectionInput | undefined, taskID: string): PickerModel[] {
  return input ? modelsForTaskInput(input, taskID) : []
}

function readRuntimeRequest(value: unknown): PickerRuntimeRequest | undefined {
  if (!isRecord(value)) return undefined
  const theme = readThemeHint(value.theme)
  const modelSelection = readModelSelection(value.modelSelection)
  const setup = readSetup(value.setup)
  if (value.modelSelection !== undefined && !modelSelection) return undefined
  if (!theme && !modelSelection && !setup) return undefined
  return { ...(theme ? { theme } : {}), ...(modelSelection ? { modelSelection } : {}), ...(setup ? { setup } : {}) }
}

function readThemeHint(value: unknown): PickerThemeHint | undefined {
  if (!isRecord(value)) return undefined
  const themeID = typeof value.themeID === "string" ? value.themeID : undefined
  const colorScheme = typeof value.colorScheme === "string" ? value.colorScheme : undefined
  if (!themeID && !colorScheme) return undefined
  return { ...(themeID ? { themeID } : {}), ...(colorScheme ? { colorScheme } : {}) }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readModelSelection(value: unknown): PickerModelSelectionInput | undefined {
  if (!isRecord(value) || !Array.isArray(value.tasks) || !Array.isArray(value.models)) return undefined
  if (value.tasks.length > MAX_PICKER_TASKS || !value.tasks.every(isBoundedPickerTask)) return undefined
  if (value.models.length > MAX_PICKER_MODELS_PER_CATALOG || !value.models.every(isPickerModel)) return undefined

  const applyToAllModels = value.applyToAllModels === undefined
    ? undefined
    : Array.isArray(value.applyToAllModels) &&
        value.applyToAllModels.length <= MAX_PICKER_MODELS_PER_CATALOG &&
        value.applyToAllModels.every(isPickerModel)
      ? value.applyToAllModels
      : undefined
  if (value.applyToAllModels !== undefined && !applyToAllModels) return undefined

  const preselectedModels = readPreselectedModels(value.preselectedModels)
  const rowOnlyModels = readRowOnlyModels(value.rowOnlyModels)
  if (value.preselectedModels !== undefined && !preselectedModels) return undefined
  if (value.rowOnlyModels !== undefined && !rowOnlyModels) return undefined
  return {
    tasks: value.tasks,
    models: value.models,
    ...(applyToAllModels ? { applyToAllModels } : {}),
    ...(preselectedModels ? { preselectedModels } : {}),
    ...(rowOnlyModels ? { rowOnlyModels } : {}),
  }
}

function readSetup(value: unknown): PickerSetupInput | undefined {
  if (!isRecord(value) || !isRecord(value.settings)) return undefined
  const scope = value.scope === "project" || value.scope === "global" ? value.scope : undefined
  const projectIsGitRepo = typeof value.projectIsGitRepo === "boolean" ? value.projectIsGitRepo : undefined
  const projectConfigIgnored = typeof value.projectConfigIgnored === "boolean" ? value.projectConfigIgnored : undefined
  return {
    settings: value.settings as unknown as SetupSettings,
    ...(scope ? { scope } : {}),
    ...(projectIsGitRepo === undefined ? {} : { projectIsGitRepo }),
    ...(projectConfigIgnored === undefined ? {} : { projectConfigIgnored }),
  }
}

function readPreselectedModels(value: unknown): PickerModelSelectionInput["preselectedModels"] | undefined {
  if (!isRecord(value)) return undefined
  const entries = Object.entries(value)
  if (entries.length > MAX_PICKER_TASKS) return undefined

  const selections: NonNullable<PickerModelSelectionInput["preselectedModels"]> = {}
  for (const [taskID, model] of entries) {
    if (
      !isBoundedIdentifierString(taskID, MAX_PICKER_ID_LENGTH)
      || !isBoundedModelRef(model)
    ) return undefined
    selections[taskID] = {
      providerID: model.providerID,
      modelID: model.modelID,
      ...(typeof model.variant === "string" ? { variant: model.variant } : {}),
    }
  }
  return selections
}

function readRowOnlyModels(value: unknown): PickerModelSelectionInput["rowOnlyModels"] | undefined {
  if (!isRecord(value)) return undefined
  const entries = Object.entries(value)
  if (entries.length > MAX_PICKER_TASKS) return undefined

  const models: NonNullable<PickerModelSelectionInput["rowOnlyModels"]> = {}
  let modelCount = 0
  for (const [taskID, candidates] of entries) {
    if (
      !isBoundedIdentifierString(taskID, MAX_PICKER_ID_LENGTH) ||
      !Array.isArray(candidates) ||
      candidates.length > MAX_PICKER_MODELS_PER_PROVIDER ||
      !candidates.every(isPickerModel)
    ) {
      return undefined
    }
    modelCount += candidates.length
    if (modelCount > MAX_PICKER_MODELS_PER_CATALOG) return undefined
    models[taskID] = candidates
  }
  return models
}

function flattenCatalog(catalog: PickerRequestCatalogProvider[]): PickerModel[] {
  return catalog.flatMap((provider) =>
    provider.models.map(pickerModel),
  )
}

function pickerModel(model: PickerRequestCatalogModel): PickerModel {
  return {
    providerID: model.providerID,
    providerName: model.providerName,
    modelID: model.modelID,
    displayName: model.modelName,
    variants: readVariants(model.variants),
  }
}

function isPickerModel(value: unknown): value is PickerModel {
  return (
    isRecord(value) &&
    isBoundedIdentifierString(value.providerID, MAX_PICKER_ID_LENGTH) &&
    isBoundedDisplayString(value.providerName, MAX_PICKER_NAME_LENGTH) &&
    isBoundedIdentifierString(value.modelID, MAX_PICKER_ID_LENGTH) &&
    isBoundedDisplayString(value.displayName, MAX_PICKER_NAME_LENGTH) &&
    isBoundedVariants(value.variants)
  )
}

function readVariants(value: unknown): string[] {
  return isBoundedVariants(value) ? value : []
}

function isBoundedCatalog(value: unknown): value is PickerRequestCatalogProvider[] {
  if (!Array.isArray(value) || value.length > MAX_PICKER_PROVIDERS_PER_CATALOG) return false

  let modelCount = 0
  for (const provider of value) {
    if (!isRecord(provider)) return false
    if (
      !isBoundedIdentifierString(provider.providerID, MAX_PICKER_ID_LENGTH) ||
      !isBoundedDisplayString(provider.providerName, MAX_PICKER_NAME_LENGTH) ||
      !Array.isArray(provider.models) ||
      provider.models.length > MAX_PICKER_MODELS_PER_PROVIDER ||
      !provider.models.every(isBoundedCatalogModel)
    ) {
      return false
    }
    modelCount += provider.models.length
    if (modelCount > MAX_PICKER_MODELS_PER_CATALOG) return false
  }

  return true
}

function isBoundedCatalogModel(value: unknown): value is PickerRequestCatalogModel {
  return (
    isRecord(value) &&
    isBoundedIdentifierString(value.providerID, MAX_PICKER_ID_LENGTH) &&
    isBoundedDisplayString(value.providerName, MAX_PICKER_NAME_LENGTH) &&
    isBoundedIdentifierString(value.modelID, MAX_PICKER_ID_LENGTH) &&
    isBoundedDisplayString(value.modelName, MAX_PICKER_NAME_LENGTH) &&
    isBoundedVariants(value.variants)
  )
}

function isBoundedRequestRow(value: unknown): value is PickerRequestRow {
  return (
    isRecord(value) &&
    isBoundedIdentifierString(value.callID, MAX_PICKER_ID_LENGTH) &&
    isBoundedOptionalDisplayString(value.agentName, MAX_PICKER_NAME_LENGTH) &&
    isBoundedOptionalString(value.description, MAX_PICKER_DESCRIPTION_LENGTH) &&
    (value.preselect === undefined || isBoundedPreselection(value.preselect))
  )
}

function isBoundedPreselection(value: unknown): value is NonNullable<PickerRequestRow["preselect"]> {
  if (!isRecord(value)) return false
  const hidden = value.hidden
  const source = value.source
  const variant = value.variant
  return (
    isBoundedCatalogModel(value) &&
    typeof hidden === "boolean" &&
    (source === "agent" || source === "parent") &&
    isBoundedOptionalDisplayString(variant, MAX_PICKER_VARIANT_LENGTH)
  )
}

function isBoundedPickerTask(value: unknown): value is PickerTask {
  return (
    isRecord(value) &&
    isBoundedIdentifierString(value.id, MAX_PICKER_ID_LENGTH) &&
    isBoundedDisplayString(value.agentType, MAX_PICKER_NAME_LENGTH) &&
    isBoundedString(value.description, MAX_PICKER_DESCRIPTION_LENGTH)
  )
}

function isBoundedModelRef(value: unknown): value is { providerID: string; modelID: string; variant?: string } {
  return (
    isRecord(value) &&
    isBoundedIdentifierString(value.providerID, MAX_PICKER_ID_LENGTH) &&
    isBoundedIdentifierString(value.modelID, MAX_PICKER_ID_LENGTH) &&
    isBoundedOptionalIdentifierString(value.variant, MAX_PICKER_VARIANT_LENGTH)
  )
}

function isBoundedVariants(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_PICKER_VARIANTS_PER_MODEL &&
    value.every((variant) =>
      isBoundedIdentifierString(variant, MAX_PICKER_VARIANT_LENGTH)
    )
  )
}

function isBoundedRequiredString(value: unknown, maximum: number): value is string {
  return isBoundedString(value, maximum) && value.length > 0
}

function isBoundedOptionalString(value: unknown, maximum: number, requireNonempty = false): value is string | undefined {
  return value === undefined || (isBoundedString(value, maximum) && (!requireNonempty || value.length > 0))
}

function isBoundedString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length <= maximum
}

function isBoundedDisplayString(
  value: unknown,
  maximum: number,
): value is string {
  return (
    isBoundedRequiredString(value, maximum)
    && !UNSAFE_DISPLAY_CHARACTER_PATTERN.test(value)
  )
}

function isBoundedOptionalDisplayString(
  value: unknown,
  maximum: number,
): value is string | undefined {
  return value === undefined || isBoundedDisplayString(value, maximum)
}

function isBoundedIdentifierString(
  value: unknown,
  maximum: number,
): value is string {
  return (
    isBoundedRequiredString(value, maximum)
    && !UNSAFE_IDENTIFIER_CHARACTER_PATTERN.test(value)
  )
}

function isBoundedOptionalIdentifierString(
  value: unknown,
  maximum: number,
): value is string | undefined {
  return value === undefined || isBoundedIdentifierString(value, maximum)
}

const UNSAFE_DISPLAY_CHARACTER_PATTERN =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u
const UNSAFE_IDENTIFIER_CHARACTER_PATTERN =
  /[\p{Cc}\p{Cf}\p{Cs}\p{Z}\p{Default_Ignorable_Code_Point}]/u
