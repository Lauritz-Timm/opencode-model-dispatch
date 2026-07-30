import { lstat, mkdir, open, stat, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"

import {
  DEFAULT_SETTINGS,
  MAX_SETTINGS_FILE_BYTES,
  isValidBatchMs,
  isValidPickerTimeoutMs,
  type DispatchSettings,
  type PrivacySettings,
  type SettingsPaths,
} from "./settings.js"

export const PROJECT_CONFIG_RELATIVE_PATH = ".opencode/model-dispatch.json"
export const GITIGNORE_PROJECT_CONFIG_ENTRY = PROJECT_CONFIG_RELATIVE_PATH

export type DispatchScope = "global" | "project"

export type SetupDecision = SetupCancelDecision | SetupSubmitDecision | SetupResetDecision

export interface SetupCancelDecision {
  kind: "cancel"
}

export interface SetupSubmitDecision {
  kind: "submit"
  settings: {
    privacy: PrivacySettings
    dispatch: DispatchSettings
  }
  dispatchScope: DispatchScope
  addProjectConfigToGitignore?: boolean
}

export interface SetupResetDecision {
  kind: "reset"
  dispatchScope: DispatchScope
  addProjectConfigToGitignore?: boolean
}

export interface SetupResult {
  messages: string[]
}

export type SetupDecisionParseResult =
  | SetupDecision
  | { kind: "technical_failure"; reason: string }

export interface GitignoreOption {
  available: boolean
  checked: boolean
}

export interface SetupFileSystem {
  mkdir(path: string, options: { recursive: true }): Promise<unknown>
  open(path: string, flags: "r"): Promise<{
    stat(): Promise<{
      dev: number | bigint
      ino: number | bigint
      size: number
      isFile(): boolean
    }>
    read(
      buffer: Uint8Array,
      offset: number,
      length: number,
      position: number,
    ): Promise<{ bytesRead: number }>
    close(): Promise<void>
  }>
  writeFile(path: string, data: string, encoding: "utf8"): Promise<unknown>
  stat(path: string): Promise<{ isDirectory(): boolean }>
  lstat(path: string): Promise<{
    dev: number | bigint
    ino: number | bigint
    isFile(): boolean
    isSymbolicLink(): boolean
  }>
}

export interface SetupOptions {
  now?: Date
  fs?: SetupFileSystem
  projectRoot?: string
}

type PartialSetupSettings = Partial<{
  privacy: Partial<PrivacySettings>
  dispatch: Partial<DispatchSettings>
  setup: { snoozed_until: number }
}>

const DAY_MS = 24 * 60 * 60 * 1000
export const MAX_GITIGNORE_FILE_BYTES = 1024 * 1024
const DEFAULT_FS: SetupFileSystem = {
  mkdir,
  open,
  writeFile,
  stat,
  lstat,
}

export function parseSetupDecisionPayload(payload: unknown): SetupDecisionParseResult {
  if (
    !isRecord(payload)
    || (payload.scope !== "global" && payload.scope !== "project")
    || typeof payload.addProjectConfigToGitignore !== "boolean"
  ) {
    return {
      kind: "technical_failure",
      reason: "Picker returned an invalid setup payload",
    }
  }

  const dispatchScope = payload.scope
  const addProjectConfigToGitignore = payload.addProjectConfigToGitignore
  if (payload.action === "reset") {
    return { kind: "reset", dispatchScope, addProjectConfigToGitignore }
  }
  if (payload.action !== undefined || !isRecord(payload.settings)) {
    return {
      kind: "technical_failure",
      reason: "Picker returned an invalid setup payload",
    }
  }

  const privacy = payload.settings.privacy
  const dispatch = payload.settings.dispatch
  if (
    !isRecord(privacy)
    || !isRecord(dispatch)
    || typeof privacy.logging_enabled !== "boolean"
    || typeof dispatch.enabled !== "boolean"
    || !isValidBatchMs(dispatch.batch_ms)
    || !isValidPickerTimeoutMs(dispatch.picker_timeout_ms)
    || dispatch.technical_failure !== "default_model"
  ) {
    return {
      kind: "technical_failure",
      reason: "Picker returned invalid model dispatch settings",
    }
  }

  return {
    kind: "submit",
    settings: {
      privacy: { logging_enabled: privacy.logging_enabled },
      dispatch: {
        enabled: dispatch.enabled,
        batch_ms: dispatch.batch_ms,
        picker_timeout_ms: dispatch.picker_timeout_ms,
        technical_failure: dispatch.technical_failure,
      },
    },
    dispatchScope,
    addProjectConfigToGitignore,
  }
}

export async function shouldOpenFirstRunSetup(paths: SettingsPaths, options: SetupOptions = {}): Promise<boolean> {
  const fs = options.fs ?? DEFAULT_FS
  const now = options.now ?? new Date()
  const globalSettings = await readPartialSettings(fs, paths.globalPath, false)
  const projectSettings = await readPartialSettings(fs, paths.projectPath, true)
  const snoozedUntil = Math.max(globalSettings?.setup?.snoozed_until ?? 0, projectSettings?.setup?.snoozed_until ?? 0)

  if (snoozedUntil > now.getTime()) return false
  return !hasUserConfiguredSettings(globalSettings) && !hasUserConfiguredSettings(projectSettings)
}

export async function getProjectGitignoreOption(projectRoot: string, options: Pick<SetupOptions, "fs"> = {}): Promise<GitignoreOption> {
  const fs = options.fs ?? DEFAULT_FS
  const available = await isGitRepo(projectRoot, fs)
  if (!available) return { available: false, checked: false }
  if (await isSymbolicLink(fs, join(projectRoot, ".gitignore"))) {
    return { available: false, checked: false }
  }
  try {
    const lines = (
      await readBoundedRegularFile(
        fs,
        join(projectRoot, ".gitignore"),
        MAX_GITIGNORE_FILE_BYTES,
        true,
        ".gitignore",
      )
    ).split(/\r?\n/)
    return { available: true, checked: lines.includes(GITIGNORE_PROJECT_CONFIG_ENTRY) }
  } catch (error) {
    if (error instanceof UnsafeSetupFileError) {
      return { available: false, checked: false }
    }
    if (!isNotFound(error)) throw error
    return { available: true, checked: false }
  }
}

export async function getConfiguredDispatchScope(
  paths: SettingsPaths,
  options: Pick<SetupOptions, "fs"> = {},
): Promise<DispatchScope> {
  const projectSettings = await readSettingsRecord(
    options.fs ?? DEFAULT_FS,
    paths.projectPath,
    true,
  )
  return isRecord(projectSettings?.dispatch) ? "project" : "global"
}

export async function applySetupDecision(paths: SettingsPaths, decision: SetupDecision, options: SetupOptions = {}): Promise<SetupResult> {
  const fs = options.fs ?? DEFAULT_FS
  const projectRoot = options.projectRoot ?? projectRootFromProjectPath(paths.projectPath)
  const messages: string[] = []

  if (decision.kind === "cancel") {
    const now = options.now ?? new Date()
    await writePartialSettings(
      fs,
      paths.globalPath,
      {
        dispatch: { enabled: false },
        setup: { snoozed_until: now.getTime() + DAY_MS },
      },
      false,
    )
    return { messages: ["Setup cancelled. Model dispatch is disabled for now and setup is snoozed for 24 hours."] }
  }

  const privacy = decision.kind === "reset" ? DEFAULT_SETTINGS.privacy : decision.settings.privacy
  const dispatch = decision.kind === "reset" ? DEFAULT_SETTINGS.dispatch : decision.settings.dispatch
  await assertSafeProjectConfigTarget(fs, projectRoot, paths.projectPath)
  await writePartialSettings(
    fs,
    paths.globalPath,
    decision.dispatchScope === "global" ? { privacy, dispatch } : { privacy },
    false,
  )

  if (decision.dispatchScope === "project") {
    await writePartialSettings(fs, paths.projectPath, { dispatch }, true)
    await updateGitignoreForProjectConfig(fs, projectRoot, decision.addProjectConfigToGitignore === true, messages)
  } else {
    if (await removeSettingsSection(fs, paths.projectPath, "dispatch", true)) {
      messages.push("The existing project dispatch override was cleared so global settings take effect.")
    }
  }

  return { messages }
}

async function removeSettingsSection(
  fs: SetupFileSystem,
  path: string,
  section: string,
  rejectSymlink: boolean,
): Promise<boolean> {
  const existing = await readSettingsRecord(fs, path, rejectSymlink)
  if (!existing || !(section in existing)) return false
  const next = { ...existing }
  delete next[section]
  await fs.mkdir(dirname(path), { recursive: true })
  await fs.writeFile(path, `${JSON.stringify(next, null, 2)}\n`, "utf8")
  return true
}

async function updateGitignoreForProjectConfig(fs: SetupFileSystem, projectRoot: string, shouldAdd: boolean, messages: string[]): Promise<void> {
  if (!(await isGitRepo(projectRoot, fs))) {
    messages.push("Project is not a git repo; no .gitignore update needed.")
    return
  }

  const gitignorePath = join(projectRoot, ".gitignore")
  if (await isSymbolicLink(fs, gitignorePath)) {
    messages.push("The project's .gitignore is a symbolic link and was not modified.")
    return
  }
  let existing = ""
  try {
    existing = await readBoundedRegularFile(
      fs,
      gitignorePath,
      MAX_GITIGNORE_FILE_BYTES,
      true,
      ".gitignore",
    )
  } catch (error) {
    if (error instanceof UnsafeSetupFileError) {
      messages.push(
        `The project's .gitignore was not modified: ${error.message}.`,
      )
      return
    }
    if (!isNotFound(error)) throw error
  }

  if (!shouldAdd) {
    const lines = existing.split(/\r?\n/)
    if (lines.includes(GITIGNORE_PROJECT_CONFIG_ENTRY)) {
      await fs.writeFile(
        gitignorePath,
        lines.filter((line) => line !== GITIGNORE_PROJECT_CONFIG_ENTRY).join("\n"),
        "utf8",
      )
      messages.push(`${PROJECT_CONFIG_RELATIVE_PATH} was removed from .gitignore.`)
    } else {
      messages.push(`${PROJECT_CONFIG_RELATIVE_PATH} was not added to .gitignore; avoid committing project-specific model dispatch settings if they are private.`)
    }
    return
  }

  const lines = existing.split(/\r?\n/).filter((line) => line.length > 0)
  if (!lines.includes(GITIGNORE_PROJECT_CONFIG_ENTRY)) {
    const prefix = existing.length > 0 && !existing.endsWith("\n") ? `${existing}\n` : existing
    await fs.writeFile(gitignorePath, `${prefix}${GITIGNORE_PROJECT_CONFIG_ENTRY}\n`, "utf8")
  }
  messages.push(`${PROJECT_CONFIG_RELATIVE_PATH} was added to .gitignore.`)
}

async function writePartialSettings(
  fs: SetupFileSystem,
  path: string,
  settings: PartialSetupSettings,
  rejectSymlink: boolean,
): Promise<void> {
  const existing = await readSettingsRecord(fs, path, rejectSymlink)
  const merged: Record<string, unknown> = { ...existing }
  for (const [section, value] of Object.entries(settings)) {
    const currentSection = isRecord(existing?.[section]) ? existing[section] : {}
    merged[section] = { ...currentSection, ...value }
  }
  await fs.mkdir(dirname(path), { recursive: true })
  await fs.writeFile(path, `${JSON.stringify(merged, null, 2)}\n`, "utf8")
}

async function readPartialSettings(
  fs: SetupFileSystem,
  path: string,
  rejectSymlink: boolean,
): Promise<PartialSetupSettings | undefined> {
  return await readSettingsRecord(
    fs,
    path,
    rejectSymlink,
  ) as PartialSetupSettings | undefined
}

async function readSettingsRecord(
  fs: SetupFileSystem,
  path: string,
  rejectSymlink: boolean,
): Promise<Record<string, unknown> | undefined> {
  try {
    const parsed: unknown = JSON.parse(
      await readBoundedRegularFile(
        fs,
        path,
        MAX_SETTINGS_FILE_BYTES,
        rejectSymlink,
        "settings file",
      ),
    )
    return isRecord(parsed) ? parsed : undefined
  } catch (error) {
    if (isNotFound(error) || error instanceof SyntaxError) return undefined
    throw error
  }
}

async function readBoundedRegularFile(
  fs: SetupFileSystem,
  path: string,
  maxBytes: number,
  rejectSymlink: boolean,
  label: string,
): Promise<string> {
  const before = await fs.lstat(path)
  if (rejectSymlink && before.isSymbolicLink()) {
    throw new UnsafeSetupFileError(`${label} must not be a symbolic link`)
  }
  if (!before.isFile() && !before.isSymbolicLink()) {
    throw new UnsafeSetupFileError(`${label} must be a regular file`)
  }

  const handle = await fs.open(path, "r")
  try {
    const opened = await handle.stat()
    if (!opened.isFile()) {
      throw new UnsafeSetupFileError(`${label} must be a regular file`)
    }
    if (
      rejectSymlink
      && (before.dev !== opened.dev || before.ino !== opened.ino)
    ) {
      throw new UnsafeSetupFileError(`${label} changed while being opened`)
    }
    if (opened.size > maxBytes) {
      throw new UnsafeSetupFileError(`${label} exceeds ${maxBytes} bytes`)
    }

    const buffer = Buffer.alloc(maxBytes + 1)
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
    if (offset > maxBytes) {
      throw new UnsafeSetupFileError(`${label} exceeds ${maxBytes} bytes`)
    }
    return buffer.toString("utf8", 0, offset)
  } finally {
    await handle.close()
  }
}

class UnsafeSetupFileError extends Error {}

function hasUserConfiguredSettings(settings: PartialSetupSettings | undefined): boolean {
  return settings?.privacy !== undefined || settings?.dispatch !== undefined
}

async function isGitRepo(projectRoot: string, fs: SetupFileSystem): Promise<boolean> {
  try {
    await fs.stat(join(projectRoot, ".git"))
    return true
  } catch (error) {
    if (isNotFound(error)) return false
    throw error
  }
}

function projectRootFromProjectPath(projectPath: string): string {
  return dirname(dirname(projectPath))
}

async function assertSafeProjectConfigTarget(
  fs: SetupFileSystem,
  projectRoot: string,
  projectPath: string,
): Promise<void> {
  const expectedPath = resolve(projectRoot, PROJECT_CONFIG_RELATIVE_PATH)
  if (resolve(projectPath) !== expectedPath) {
    throw new Error(`Refusing to write project settings outside ${PROJECT_CONFIG_RELATIVE_PATH}`)
  }
  await rejectSymbolicLink(fs, join(projectRoot, ".opencode"), ".opencode")
  await rejectSymbolicLink(fs, projectPath, PROJECT_CONFIG_RELATIVE_PATH)
}

async function rejectSymbolicLink(
  fs: SetupFileSystem,
  path: string,
  label: string,
): Promise<void> {
  if (await isSymbolicLink(fs, path)) {
    throw new Error(`Refusing to read or write a symbolic-link ${label}`)
  }
}

async function isSymbolicLink(
  fs: SetupFileSystem,
  path: string,
): Promise<boolean> {
  try {
    return (await fs.lstat(path)).isSymbolicLink()
  } catch (error) {
    if (isNotFound(error)) return false
    throw error
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
