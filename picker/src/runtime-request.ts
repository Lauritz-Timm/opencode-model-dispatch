export interface PickerThemeHint {
  themeID?: string
  colorScheme?: string
}

export interface PickerRuntimeRequest {
  theme?: PickerThemeHint
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

function readRuntimeRequest(value: unknown): PickerRuntimeRequest | undefined {
  if (!isRecord(value)) return undefined
  const theme = readThemeHint(value.theme)
  return theme ? { theme } : undefined
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
