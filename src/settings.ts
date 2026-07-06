import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

export type TechnicalFailureMode = "default_model"

export interface DispatchSettings {
  enabled: boolean
  batch_ms: number
  picker_timeout_ms: number
  technical_failure: TechnicalFailureMode
}

export interface PrivacySettings {
  logging_enabled: boolean
}

export interface SetupSettings {
  snoozed_until: number
}

export interface ModelDispatchSettings {
  privacy: PrivacySettings
  dispatch: DispatchSettings
  setup: SetupSettings
}

export interface SettingsPaths {
  globalPath: string
  projectPath: string
}

export interface ReadSettingsResult {
  settings: ModelDispatchSettings
  warnings: string[]
}

type PartialSettings = Partial<{
  privacy: Partial<PrivacySettings>
  dispatch: Partial<DispatchSettings>
  setup: Partial<SetupSettings>
}>

export const DEFAULT_SETTINGS: ModelDispatchSettings = {
  privacy: { logging_enabled: true },
  dispatch: {
    enabled: false,
    batch_ms: 500,
    picker_timeout_ms: 20000,
    technical_failure: "default_model",
  },
  setup: { snoozed_until: 0 },
}

export async function readSettings(paths: SettingsPaths): Promise<ReadSettingsResult> {
  const warnings: string[] = []
  const globalSettings = await readSettingsFile(paths.globalPath, warnings)
  const projectSettings = await readSettingsFile(paths.projectPath, warnings)

  if (warnings.length > 0) {
    return { settings: cloneSettings(DEFAULT_SETTINGS), warnings }
  }

  return {
    settings: mergeSettings(globalSettings, projectSettings),
    warnings,
  }
}

export async function writeSettings(path: string, settings: PartialSettings): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(settings, null, 2)}\n`, "utf8")
}

export function snoozeSetupFor24Hours(settings: ModelDispatchSettings, now = new Date()): ModelDispatchSettings {
  return {
    ...settings,
    setup: { ...settings.setup, snoozed_until: now.getTime() + 24 * 60 * 60 * 1000 },
  }
}

function mergeSettings(globalSettings: PartialSettings | undefined, projectSettings: PartialSettings | undefined): ModelDispatchSettings {
  return {
    privacy: {
      ...DEFAULT_SETTINGS.privacy,
      ...globalSettings?.privacy,
    },
    dispatch: {
      ...DEFAULT_SETTINGS.dispatch,
      ...globalSettings?.dispatch,
      ...projectSettings?.dispatch,
    },
    setup: {
      ...DEFAULT_SETTINGS.setup,
      ...globalSettings?.setup,
      ...projectSettings?.setup,
    },
  }
}

async function readSettingsFile(path: string, warnings: string[]): Promise<PartialSettings | undefined> {
  let raw: string
  try {
    raw = await readFile(path, "utf8")
  } catch (error) {
    if (isNotFound(error)) return undefined
    warnings.push(`${path}: ${(error as Error).message}`)
    return undefined
  }

  try {
    return decodeSettings(JSON.parse(raw))
  } catch (error) {
    warnings.push(`${path}: ${(error as Error).message}`)
    return undefined
  }
}

function decodeSettings(value: unknown): PartialSettings {
  if (!isRecord(value)) return {}
  const decoded: PartialSettings = {}

  if (isRecord(value.privacy)) {
    decoded.privacy = {}
    if (typeof value.privacy.logging_enabled === "boolean") decoded.privacy.logging_enabled = value.privacy.logging_enabled
  }

  if (isRecord(value.dispatch)) {
    decoded.dispatch = {}
    if (typeof value.dispatch.enabled === "boolean") decoded.dispatch.enabled = value.dispatch.enabled
    if (typeof value.dispatch.batch_ms === "number") decoded.dispatch.batch_ms = value.dispatch.batch_ms
    if (typeof value.dispatch.picker_timeout_ms === "number") decoded.dispatch.picker_timeout_ms = value.dispatch.picker_timeout_ms
    if (value.dispatch.technical_failure === "default_model") decoded.dispatch.technical_failure = value.dispatch.technical_failure
  }

  if (isRecord(value.setup)) {
    decoded.setup = {}
    if (typeof value.setup.snoozed_until === "number") decoded.setup.snoozed_until = value.setup.snoozed_until
  }

  return decoded
}

function cloneSettings(settings: ModelDispatchSettings): ModelDispatchSettings {
  return JSON.parse(JSON.stringify(settings)) as ModelDispatchSettings
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isNotFound(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT"
}
