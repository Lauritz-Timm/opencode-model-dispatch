import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

import { DEFAULT_SETTINGS, type DispatchSettings, type PrivacySettings, type SettingsPaths } from "./settings"

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

export interface GitignoreOption {
  available: boolean
  checked: boolean
}

export interface SetupFileSystem {
  mkdir(path: string, options: { recursive: true }): Promise<unknown>
  readFile(path: string, encoding: "utf8"): Promise<string>
  writeFile(path: string, data: string, encoding: "utf8"): Promise<unknown>
  stat(path: string): Promise<{ isDirectory(): boolean }>
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
const DEFAULT_FS: SetupFileSystem = { mkdir, readFile, writeFile, stat }

export async function shouldOpenFirstRunSetup(paths: SettingsPaths, options: SetupOptions = {}): Promise<boolean> {
  const fs = options.fs ?? DEFAULT_FS
  const now = options.now ?? new Date()
  const globalSettings = await readPartialSettings(fs, paths.globalPath)
  const projectSettings = await readPartialSettings(fs, paths.projectPath)
  const snoozedUntil = Math.max(globalSettings?.setup?.snoozed_until ?? 0, projectSettings?.setup?.snoozed_until ?? 0)

  if (snoozedUntil > now.getTime()) return false
  return !hasUserConfiguredSettings(globalSettings) && !hasUserConfiguredSettings(projectSettings)
}

export async function getProjectGitignoreOption(projectRoot: string, options: Pick<SetupOptions, "fs"> = {}): Promise<GitignoreOption> {
  const available = await isGitRepo(projectRoot, options.fs ?? DEFAULT_FS)
  return { available, checked: available }
}

export async function applySetupDecision(paths: SettingsPaths, decision: SetupDecision, options: SetupOptions = {}): Promise<SetupResult> {
  const fs = options.fs ?? DEFAULT_FS
  const projectRoot = options.projectRoot ?? projectRootFromProjectPath(paths.projectPath)
  const messages: string[] = []

  if (decision.kind === "cancel") {
    const now = options.now ?? new Date()
    await writePartialSettings(fs, paths.globalPath, {
      dispatch: { enabled: false },
      setup: { snoozed_until: now.getTime() + DAY_MS },
    })
    return { messages: ["Setup cancelled. Model dispatch is disabled for now and setup is snoozed for 24 hours."] }
  }

  const privacy = decision.kind === "reset" ? DEFAULT_SETTINGS.privacy : decision.settings.privacy
  const dispatch = decision.kind === "reset" ? DEFAULT_SETTINGS.dispatch : decision.settings.dispatch
  await writePartialSettings(fs, paths.globalPath, decision.dispatchScope === "global" ? { privacy, dispatch } : { privacy })

  if (decision.dispatchScope === "project") {
    await writePartialSettings(fs, paths.projectPath, { dispatch })
    await updateGitignoreForProjectConfig(fs, projectRoot, decision.addProjectConfigToGitignore === true, messages)
  }

  return { messages }
}

async function updateGitignoreForProjectConfig(fs: SetupFileSystem, projectRoot: string, shouldAdd: boolean, messages: string[]): Promise<void> {
  if (!(await isGitRepo(projectRoot, fs))) {
    messages.push("Project is not a git repo; no .gitignore update needed.")
    return
  }

  if (!shouldAdd) {
    messages.push(`${PROJECT_CONFIG_RELATIVE_PATH} was not added to .gitignore; avoid committing project-specific model dispatch settings if they are private.`)
    return
  }

  const gitignorePath = join(projectRoot, ".gitignore")
  let existing = ""
  try {
    existing = await fs.readFile(gitignorePath, "utf8")
  } catch (error) {
    if (!isNotFound(error)) throw error
  }

  const lines = existing.split(/\r?\n/).filter((line) => line.length > 0)
  if (!lines.includes(GITIGNORE_PROJECT_CONFIG_ENTRY)) {
    const prefix = existing.length > 0 && !existing.endsWith("\n") ? `${existing}\n` : existing
    await fs.writeFile(gitignorePath, `${prefix}${GITIGNORE_PROJECT_CONFIG_ENTRY}\n`, "utf8")
  }
  messages.push(`${PROJECT_CONFIG_RELATIVE_PATH} was added to .gitignore.`)
}

async function writePartialSettings(fs: SetupFileSystem, path: string, settings: PartialSetupSettings): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true })
  await fs.writeFile(path, `${JSON.stringify(settings, null, 2)}\n`, "utf8")
}

async function readPartialSettings(fs: SetupFileSystem, path: string): Promise<PartialSetupSettings | undefined> {
  try {
    return JSON.parse(await fs.readFile(path, "utf8")) as PartialSetupSettings
  } catch (error) {
    if (isNotFound(error)) return undefined
    throw error
  }
}

function hasUserConfiguredSettings(settings: PartialSetupSettings | undefined): boolean {
  return settings?.privacy !== undefined || settings?.dispatch !== undefined
}

async function isGitRepo(projectRoot: string, fs: SetupFileSystem): Promise<boolean> {
  try {
    return (await fs.stat(join(projectRoot, ".git"))).isDirectory()
  } catch (error) {
    if (isNotFound(error)) return false
    throw error
  }
}

function projectRootFromProjectPath(projectPath: string): string {
  return dirname(dirname(projectPath))
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
}
