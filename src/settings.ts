import { lstat, mkdir, open, writeFile } from "node:fs/promises"
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

export interface AppearanceSettings {
  theme_id?: string
  color_scheme?: "light" | "dark" | "system"
}

export interface ModelDispatchSettings {
  privacy: PrivacySettings
  dispatch: DispatchSettings
  setup: SetupSettings
  appearance: AppearanceSettings
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
  appearance: Partial<AppearanceSettings>
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
  appearance: {},
}

export const MAX_BATCH_MS = 60_000
export const MAX_PICKER_TIMEOUT_MS = 600_000
export const MAX_SETTINGS_FILE_BYTES = 64 * 1024

export function isValidBatchMs(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= MAX_BATCH_MS
}

export function isValidPickerTimeoutMs(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= MAX_PICKER_TIMEOUT_MS
}

export async function readSettings(paths: SettingsPaths): Promise<ReadSettingsResult> {
  const warnings: string[] = []
  const globalSettings = await readSettingsFile(
    paths.globalPath,
    warnings,
    false,
  )
  const projectSettings = await readSettingsFile(
    paths.projectPath,
    warnings,
    true,
  )

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
    appearance: {
      ...DEFAULT_SETTINGS.appearance,
      ...globalSettings?.appearance,
    },
  }
}

async function readSettingsFile(
  path: string,
  warnings: string[],
  rejectSymlink: boolean,
): Promise<PartialSettings | undefined> {
  let raw: string
  try {
    const before = await lstat(path)
    if (rejectSymlink && before.isSymbolicLink()) {
      throw new Error("project settings must not be a symbolic link")
    }
    const handle = await open(path, "r")
    try {
      const opened = await handle.stat()
      if (!opened.isFile()) {
        throw new Error("settings path must be a regular file")
      }
      if (
        rejectSymlink &&
        (before.dev !== opened.dev || before.ino !== opened.ino)
      ) {
        throw new Error("project settings changed while being opened")
      }
      if (opened.size > MAX_SETTINGS_FILE_BYTES) {
        throw new Error(
          `settings file exceeds ${MAX_SETTINGS_FILE_BYTES} bytes`,
        )
      }
      raw = await readBoundedSettingsFile(handle)
    } finally {
      await handle.close()
    }
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

async function readBoundedSettingsFile(
  handle: Awaited<ReturnType<typeof open>>,
): Promise<string> {
  const buffer = Buffer.alloc(MAX_SETTINGS_FILE_BYTES + 1)
  let offset = 0
  while (offset < buffer.byteLength) {
    const { bytesRead } = await handle.read(
      buffer,
      offset,
      buffer.byteLength - offset,
      offset,
    )
    if (bytesRead === 0) break
    offset += bytesRead
  }
  if (offset > MAX_SETTINGS_FILE_BYTES) {
    throw new Error(
      `settings file exceeds ${MAX_SETTINGS_FILE_BYTES} bytes`,
    )
  }
  return buffer.toString("utf8", 0, offset)
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
    if (isValidBatchMs(value.dispatch.batch_ms)) decoded.dispatch.batch_ms = value.dispatch.batch_ms
    if (isValidPickerTimeoutMs(value.dispatch.picker_timeout_ms)) {
      decoded.dispatch.picker_timeout_ms = value.dispatch.picker_timeout_ms
    }
    if (value.dispatch.technical_failure === "default_model") decoded.dispatch.technical_failure = value.dispatch.technical_failure
  }

  if (isRecord(value.setup)) {
    decoded.setup = {}
    if (typeof value.setup.snoozed_until === "number") decoded.setup.snoozed_until = value.setup.snoozed_until
  }

  if (isRecord(value.appearance)) {
    decoded.appearance = {}
    if (typeof value.appearance.theme_id === "string") decoded.appearance.theme_id = value.appearance.theme_id
    if (value.appearance.color_scheme === "light" || value.appearance.color_scheme === "dark" || value.appearance.color_scheme === "system") {
      decoded.appearance.color_scheme = value.appearance.color_scheme
    }
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
