import type { PickerModel, PickerTask } from "./model-selection-reducer"
import type { ConfigScope, SetupSettings } from "./setup-reducer"

export interface PickerThemeHint {
  themeID?: string
  colorScheme?: string
}

export interface PickerModelSelectionInput {
  tasks: PickerTask[]
  models: PickerModel[]
}

export interface PickerSetupInput {
  settings: SetupSettings
  scope?: ConfigScope
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

function readRuntimeRequest(value: unknown): PickerRuntimeRequest | undefined {
  if (!isRecord(value)) return undefined
  const theme = readThemeHint(value.theme)
  const modelSelection = readModelSelection(value.modelSelection)
  const setup = readSetup(value.setup)
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
  return typeof value === "object" && value !== null
}

function readModelSelection(value: unknown): PickerModelSelectionInput | undefined {
  if (!isRecord(value) || !Array.isArray(value.tasks) || !Array.isArray(value.models)) return undefined
  return { tasks: value.tasks as PickerTask[], models: value.models as PickerModel[] }
}

function readSetup(value: unknown): PickerSetupInput | undefined {
  if (!isRecord(value) || !isRecord(value.settings)) return undefined
  const scope = value.scope === "project" || value.scope === "global" ? value.scope : undefined
  return { settings: value.settings as unknown as SetupSettings, ...(scope ? { scope } : {}) }
}
