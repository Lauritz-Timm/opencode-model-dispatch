import { homedir } from "node:os"
import { join } from "node:path"

import type { Hooks, Plugin, PluginInput } from "@opencode-ai/plugin"
import { createOpencodeClient as createV2Client } from "@opencode-ai/sdk/v2/client"

import { TaskBatcher, type BatchResult, type ReadyBatch, type TaskCall } from "./batcher.js"
import { createLoopbackOnlyTransport, isLoopbackHttpUrl } from "./loopback-transport.js"
import { logDispatchFailure, logDispatchSuccess, MODEL_DISPATCH_CANCELLED, MODEL_DISPATCH_PICKER_FAILED, type PluginLogger } from "./logging.js"
import { shapeModelCatalog, type ModelCatalogClient, type ModelSelection, type ShapeModelCatalogResult } from "./model-catalog.js"
import { launchPickerProcess, type PickerDecision } from "./picker-process.js"
import {
  DEFAULT_SETTINGS,
  readSettings,
  type ModelDispatchSettings,
  type ReadSettingsResult,
} from "./settings.js"
import {
  applySetupDecision,
  getConfiguredDispatchScope,
  getProjectGitignoreOption,
  parseSetupDecisionPayload,
  shouldOpenFirstRunSetup,
  type SetupDecision,
} from "./setup.js"

export interface PickerRequest extends ShapeModelCatalogResult {
  batchID: string
  sessionID: string
  timeoutMs: number
  theme?: PickerThemeHint
}

export interface PickerThemeHint {
  themeID?: string
  colorScheme?: "light" | "dark" | "system"
}

export interface ModelDispatchPluginDeps {
  readSettings?: (input: PluginInput) => Promise<ReadSettingsResult>
  logger?: PluginLogger
  scheduleBatch?: (fn: () => void, delayMs: number) => void
  launchPicker?: (request: PickerRequest) => Promise<PickerDecision>
  shouldOpenFirstRunSetup?: (input: PluginInput, settingsResult: ReadSettingsResult) => Promise<boolean>
  openFirstRunSetup?: (input: PluginInput, settings: ModelDispatchSettings) => Promise<void>
  configureModelDispatch?: (input: PluginInput, settings: ModelDispatchSettings) => Promise<string>
  persistSessionModel?: (sessionID: string, model: ModelSelection) => Promise<void>
}

type ToolBeforeInput = { tool: string; sessionID: string; callID: string }
type ToolBeforeOutput = { args: Record<string, unknown> }
type ToolAfterInput = { tool: string; sessionID: string; callID: string; args: Record<string, unknown> }
type ToolAfterOutput = {
  metadata?: Record<string, unknown> & {
    model?: { providerID: string; modelID: string; variant?: string }
  }
}
type ChatMessageInput = {
  sessionID: string
  agent?: string
  model?: { providerID: string; modelID: string }
  variant?: string
}
type ChatMessageOutput = {
  message: { model?: { providerID: string; modelID: string; variant?: string } }
}

interface PendingModelOverride {
  callID: string
  parentSessionID: string
  agentName: string
  model: ModelSelection
}

interface PendingModelOverrideEntry {
  override: PendingModelOverride
  ready: Promise<void>
  release: () => void
  released: boolean
  consumed: boolean
}

const DEFAULT_LOGGER: PluginLogger = {
  info: (entry) => console.info(JSON.stringify(entry)),
  error: (entry) => console.error(JSON.stringify(entry)),
}

export function createModelDispatchPlugin(deps: ModelDispatchPluginDeps = {}): Plugin {
  return async (input) => {
    const settingsResult = await (deps.readSettings ?? readDefaultSettings)(input)
    const settings = settingsResult.settings
    const logger = deps.logger ?? DEFAULT_LOGGER
    const overrides = new ModelOverrideQueue()
    const persistSessionModel = deps.persistSessionModel ?? createSessionModelPersister(input)
    if (await shouldOpenSetup(input, settingsResult, deps)) {
      await (deps.openFirstRunSetup ?? defaultOpenFirstRunSetup)(input, settings)
    }
    const batcher = new TaskBatcher({
      batchMs: settings.dispatch.batch_ms,
      schedule: deps.scheduleBatch,
      onReady: (batch) => {
        void dispatchBatch(batch, input.client as unknown as ModelCatalogClient, input.directory, settings, logger, batcher, deps)
      },
    })

    const hooks: Hooks = {
      dispose: async () => {
        overrides.clear()
      },
      tool: {
        configure_model_dispatch: {
          description: "Configure opencode-model-dispatch.",
          args: {},
          execute: async () => deps.configureModelDispatch
            ? deps.configureModelDispatch(input, settings)
            : defaultConfigureModelDispatch(input, settings, batcher),
        },
      },
      "chat.message": async (hookInput, hookOutput) => {
        await applyPendingModelOverride(
          hookInput as ChatMessageInput,
          hookOutput as ChatMessageOutput,
          input.client as unknown as ModelCatalogClient,
          input.directory,
          overrides,
          persistSessionModel,
        )
      },
      "tool.execute.before": async (hookInput, hookOutput) => {
        await beforeTask(
          hookInput as ToolBeforeInput,
          hookOutput as ToolBeforeOutput,
          settings,
          batcher,
          overrides,
          input.client as unknown as ModelCatalogClient,
          input.directory,
        )
      },
      "tool.execute.after": async (hookInput, hookOutput) => {
        afterTask(hookInput as ToolAfterInput, hookOutput as ToolAfterOutput, overrides)
      },
    }

    return hooks
  }
}

export const server = createModelDispatchPlugin()
export default { id: "opencode-model-dispatch", server }

async function beforeTask(
  input: ToolBeforeInput,
  output: ToolBeforeOutput,
  settings: ModelDispatchSettings,
  batcher: TaskBatcher,
  overrides: ModelOverrideQueue,
  client: ModelCatalogClient,
  directory: string,
): Promise<void> {
  if (input.tool !== "task" || !settings.dispatch.enabled) return

  const originalArgs = output.args
  const result = await batcher.enqueue({ callID: input.callID, sessionID: input.sessionID, args: originalArgs })
  if (result.kind === "fallback") {
    await showWarning(client, directory, "Model dispatch picker failed; using the configured fallback model.")
    return
  }

  const agentName = typeof originalArgs.subagent_type === "string" ? originalArgs.subagent_type : undefined
  if (!agentName) return
  await overrides.enqueue({
    callID: input.callID,
    parentSessionID: input.sessionID,
    agentName,
    model: result.model,
  })
}

function afterTask(input: ToolAfterInput, output: ToolAfterOutput | undefined, overrides: ModelOverrideQueue): void {
  if (input.tool !== "task") return
  const selection = overrides.complete(input.sessionID, input.callID)
  if (!selection || !output?.metadata) return
  output.metadata.model = { ...selection.model }
}

async function dispatchBatch(
  batch: ReadyBatch,
  client: ModelCatalogClient,
  directory: string,
  settings: ModelDispatchSettings,
  logger: PluginLogger,
  batcher: TaskBatcher,
  deps: ModelDispatchPluginDeps,
): Promise<void> {
  const batchID = `${batch.sessionID}:${batch.calls.map((call) => call.callID).join(",")}`
  let settled = false
  try {
    const catalog = await shapeModelCatalog({ client, directory, sessionID: batch.sessionID, tasks: batch.calls })
    const decision = await (deps.launchPicker ?? defaultLaunchPicker)({
      ...catalog,
      batchID,
      sessionID: batch.sessionID,
      timeoutMs: settings.dispatch.picker_timeout_ms,
      theme: await resolvePickerTheme(settings, client, directory),
    })

    if (decision.kind === "cancel") {
      batcher.cancelBatch(batch.sessionID)
      settled = true
      for (const call of batch.calls) logCancelled(settings, logger, batchID, call)
      return
    }

    if (decision.kind === "technical_failure") {
      batcher.failBatch(batch.sessionID, decision.reason)
      settled = true
      for (const call of batch.calls) logPickerFailed(settings, logger, batchID, call)
      return
    }

    const selections = selectionsFromPayload(decision.payload, batch.calls, catalog)
    batcher.resolveBatch(batch.sessionID, selections)
    settled = true
    logDispatchSuccess(settings, logger, {
      batchID,
      callIDs: batch.calls.map((call) => call.callID),
      sessionID: batch.sessionID,
      platform: process.platform,
      pickerVersion: "unknown",
      ipcStatus: "connected",
      processStatus: "completed",
      selectedCount: selections.length,
    })
  } catch (error) {
    if (settled) return
    batcher.failBatch(batch.sessionID, error instanceof Error ? error.message : String(error))
    for (const call of batch.calls) {
      try {
        logPickerFailed(settings, logger, batchID, call)
      } catch {
        // A logger failure must not strand task hooks after the picker failed.
      }
    }
  }
}

async function defaultLaunchPicker(request: PickerRequest): Promise<PickerDecision> {
  const launched = await launchPickerProcess({ timeoutMs: request.timeoutMs, request })
  if (launched.kind === "technical_failure") return launched
  return launched.result
}

function selectionsFromPayload(
  payload: unknown,
  calls: TaskCall[],
  catalog: ShapeModelCatalogResult,
): Array<{ callID: string; model: ModelSelection }> {
  if (!isRecord(payload)) return []
  const applyToAllModels = allowedModels(catalog.applyToAllCatalog)
  const applyToAll = readModel(payload.applyToAll) ?? readModel(payload.applyToAllModel)
  if (applyToAll && modelIsAllowed(applyToAll, applyToAllModels)) {
    return calls.map((call) => ({ callID: call.callID, model: applyToAll }))
  }

  if (!Array.isArray(payload.selections)) return []
  const callsByID = new Set(calls.map((call) => call.callID))
  const sharedModels = allowedModels(catalog.catalog)
  const rowModels = new Map(catalog.rows.map((row) => {
    const models = new Map(sharedModels)
    if (row.preselect) models.set(modelKey(row.preselect), new Set(row.preselect.variants))
    return [row.callID, models]
  }))
  const selections: Array<{ callID: string; model: ModelSelection }> = []
  for (const selection of payload.selections) {
    if (!isRecord(selection)) continue
    const callID = typeof selection.callID === "string" ? selection.callID : typeof selection.taskID === "string" ? selection.taskID : undefined
    if (!callID || !callsByID.has(callID)) continue
    const model = readModel(selection.model) ?? readModel(selection)
    if (model && modelIsAllowed(model, rowModels.get(callID) ?? sharedModels)) {
      selections.push({ callID, model })
    }
  }
  return selections
}

function allowedModels(catalog: ShapeModelCatalogResult["catalog"]): Map<string, Set<string>> {
  return new Map(catalog.flatMap((provider) =>
    provider.models.map((model) => [modelKey(model), new Set(model.variants)] as const)
  ))
}

function modelIsAllowed(model: ModelSelection, allowed: Map<string, Set<string>>): boolean {
  const variants = allowed.get(modelKey(model))
  if (!variants) return false
  return !model.variant || variants.has(model.variant)
}

function modelKey(model: ModelSelection): string {
  return JSON.stringify([model.providerID, model.modelID])
}

function readModel(value: unknown): ModelSelection | undefined {
  if (!isRecord(value) || typeof value.providerID !== "string" || typeof value.modelID !== "string") return undefined
  const variant = typeof value.variant === "string" && value.variant.length > 0 ? value.variant : undefined
  return {
    providerID: value.providerID,
    modelID: value.modelID,
    ...(variant ? { variant } : {}),
  }
}

function logCancelled(settings: ModelDispatchSettings, logger: PluginLogger, batchID: string, call: TaskCall): void {
  logDispatchFailure(settings, logger, {
    code: MODEL_DISPATCH_CANCELLED,
    category: "user_cancelled",
    batchID,
    callID: call.callID,
    sessionID: call.sessionID,
    platform: process.platform,
    pickerVersion: "unknown",
    ipcStatus: "connected",
    processStatus: "cancelled",
  })
}

function logPickerFailed(settings: ModelDispatchSettings, logger: PluginLogger, batchID: string, call: TaskCall): void {
  logDispatchFailure(settings, logger, {
    code: MODEL_DISPATCH_PICKER_FAILED,
    category: "technical_failure",
    batchID,
    callID: call.callID,
    sessionID: call.sessionID,
    platform: process.platform,
    pickerVersion: "unknown",
    ipcStatus: "disconnected",
    processStatus: "failed",
  })
}

async function readDefaultSettings(input: PluginInput): Promise<ReadSettingsResult> {
  return readSettings(settingsPaths(input))
}

async function shouldOpenSetup(input: PluginInput, settingsResult: ReadSettingsResult, deps: ModelDispatchPluginDeps): Promise<boolean> {
  if (deps.shouldOpenFirstRunSetup) return deps.shouldOpenFirstRunSetup(input, settingsResult)
  return shouldOpenFirstRunSetup(settingsPaths(input))
}

async function defaultOpenFirstRunSetup(input: PluginInput, settings: ModelDispatchSettings): Promise<void> {
  const decision = await openSetupPicker(input, settings)
  if (decision.kind === "technical_failure") {
    console.error(`Model dispatch setup could not open: ${decision.reason}`)
    return
  }
  await applySetupDecision(settingsPaths(input), decision)
  if (decision.kind === "cancel") {
    settings.dispatch.enabled = false
  } else if (decision.kind === "submit") {
    Object.assign(settings.privacy, decision.settings.privacy)
    Object.assign(settings.dispatch, decision.settings.dispatch)
  } else {
    Object.assign(settings.privacy, DEFAULT_SETTINGS.privacy)
    Object.assign(settings.dispatch, DEFAULT_SETTINGS.dispatch)
  }
}

async function defaultConfigureModelDispatch(input: PluginInput, settings: ModelDispatchSettings, batcher: TaskBatcher): Promise<string> {
  const decision = await openSetupPicker(input, settings)
  if (decision.kind === "technical_failure") return `Model dispatch configuration failed: ${decision.reason}`
  if (decision.kind === "cancel") return "Model dispatch configuration cancelled; no settings were changed."
  const result = await applySetupDecision(settingsPaths(input), decision)
  if (decision.kind === "submit") {
    Object.assign(settings.privacy, decision.settings.privacy)
    Object.assign(settings.dispatch, decision.settings.dispatch)
  } else {
    Object.assign(settings.privacy, DEFAULT_SETTINGS.privacy)
    Object.assign(settings.dispatch, DEFAULT_SETTINGS.dispatch)
  }
  batcher.setBatchMs(settings.dispatch.batch_ms)
  return ["Model dispatch configuration saved.", ...result.messages].join(" ")
}

async function openSetupPicker(
  input: PluginInput,
  settings: ModelDispatchSettings,
): Promise<SetupDecision | { kind: "technical_failure"; reason: string }> {
  const paths = settingsPaths(input)
  const gitignoreOption = await getProjectGitignoreOption(input.directory)
  const scope = await getConfiguredDispatchScope(paths)
  const launched = await launchPickerProcess({
    timeoutMs: settings.dispatch.picker_timeout_ms,
    request: {
      mode: "setup",
      scope,
      projectIsGitRepo: gitignoreOption.available,
      projectConfigIgnored: gitignoreOption.checked,
      settings: {
        privacy: { loggingEnabled: settings.privacy.logging_enabled },
        dispatch: {
          enabled: settings.dispatch.enabled,
          batchMs: settings.dispatch.batch_ms,
          pickerTimeoutMs: settings.dispatch.picker_timeout_ms,
          technicalFailure: settings.dispatch.technical_failure,
        },
        setup: { snoozedUntil: settings.setup.snoozed_until },
      },
      theme: await resolvePickerTheme(
        settings,
        input.client as unknown as ModelCatalogClient,
        input.directory,
      ),
    },
  })
  if (launched.kind === "technical_failure") return launched
  const decision = await launched.result
  if (decision.kind === "technical_failure") return decision
  if (decision.kind === "cancel") return { kind: "cancel" }
  return parseSetupDecisionPayload(decision.payload)
}

function settingsPaths(input: PluginInput) {
  const directory = typeof input.directory === "string" ? input.directory : process.cwd()
  return {
    globalPath: join(homedir(), ".config", "opencode", "model-dispatch.json"),
    projectPath: join(directory, ".opencode", "model-dispatch.json"),
  }
}

async function resolvePickerTheme(
  settings: ModelDispatchSettings,
  client?: ModelCatalogClient,
  directory?: string,
  env: Record<string, string | undefined> = process.env,
): Promise<PickerThemeHint | undefined> {
  const configuredThemeID =
    env.OPENCODE_MODEL_DISPATCH_THEME_ID ?? settings.appearance.theme_id
  const themeID = configuredThemeID ?? await readOpenCodeThemeID(client, directory)
  const configuredColorScheme = normalizeColorScheme(
    env.OPENCODE_MODEL_DISPATCH_COLOR_SCHEME ??
      settings.appearance.color_scheme,
  )
  const colorScheme = configuredColorScheme ?? (themeID ? "system" : undefined)
  if (!themeID && !colorScheme) return undefined
  return { ...(themeID ? { themeID } : {}), ...(colorScheme ? { colorScheme } : {}) }
}

async function readOpenCodeThemeID(
  client: ModelCatalogClient | undefined,
  directory: string | undefined,
): Promise<string | undefined> {
  if (!client?.config?.get) return undefined
  try {
    const response = await client.config.get({ query: { directory } })
    const config = responseData(response)
    if (!isRecord(config) || typeof config.theme !== "string") return undefined
    const themeID = config.theme.trim()
    return themeID || undefined
  } catch {
    return undefined
  }
}

function normalizeColorScheme(value: string | undefined): PickerThemeHint["colorScheme"] | undefined {
  return value === "light" || value === "dark" || value === "system" ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

class ModelOverrideQueue {
  private readonly pendingByParentAndAgent = new Map<string, PendingModelOverrideEntry[]>()
  private readonly pendingByCall = new Map<string, PendingModelOverrideEntry>()

  enqueue(override: PendingModelOverride): Promise<void> {
    let releasePromise!: () => void
    const entry: PendingModelOverrideEntry = {
      override,
      ready: new Promise<void>((resolve) => {
        releasePromise = resolve
      }),
      release: () => {
        if (entry.released) return
        entry.released = true
        releasePromise()
      },
      released: false,
      consumed: false,
    }
    const key = overrideKey(override.parentSessionID, override.agentName)
    const pending = this.pendingByParentAndAgent.get(key) ?? []
    pending.push(entry)
    this.pendingByParentAndAgent.set(key, pending)
    this.pendingByCall.set(callKey(override.parentSessionID, override.callID), entry)
    if (pending.length === 1) entry.release()
    return entry.ready
  }

  take(parentSessionID: string, agentName: string): PendingModelOverride | undefined {
    const key = overrideKey(parentSessionID, agentName)
    const pending = this.pendingByParentAndAgent.get(key)
    const entry = pending?.shift()
    if (pending?.length === 0) this.pendingByParentAndAgent.delete(key)
    else pending?.[0]?.release()
    if (entry) entry.consumed = true
    return entry?.override
  }

  complete(parentSessionID: string, callID: string): PendingModelOverride | undefined {
    const entry = this.pendingByCall.get(callKey(parentSessionID, callID))
    this.pendingByCall.delete(callKey(parentSessionID, callID))
    if (!entry) return undefined
    const override = entry.override
    const key = overrideKey(parentSessionID, override.agentName)
    const pending = this.pendingByParentAndAgent.get(key)
    const index = pending?.indexOf(entry) ?? -1
    if (pending && index >= 0) {
      pending.splice(index, 1)
      entry.release()
      if (index === 0) pending[0]?.release()
    }
    if (pending?.length === 0) this.pendingByParentAndAgent.delete(key)
    return entry.consumed ? override : undefined
  }

  clear(): void {
    for (const entries of this.pendingByParentAndAgent.values()) {
      for (const entry of entries) entry.release()
    }
    this.pendingByParentAndAgent.clear()
    this.pendingByCall.clear()
  }
}

async function applyPendingModelOverride(
  input: ChatMessageInput,
  output: ChatMessageOutput,
  client: ModelCatalogClient,
  directory: string,
  overrides: ModelOverrideQueue,
  persistSessionModel: ((sessionID: string, model: ModelSelection) => Promise<void>) | undefined,
): Promise<void> {
  if (!input.agent || !client.session.get) return
  let response: unknown
  try {
    response = await client.session.get({ path: { id: input.sessionID }, query: { directory } })
  } catch {
    return
  }
  const session = responseData(response)
  if (!isRecord(session) || typeof session.parentID !== "string") return
  const override = overrides.take(session.parentID, input.agent)
  if (!override) return

  const previousModel = output.message.model
  const previousVariant =
    previousModel?.providerID === override.model.providerID &&
    previousModel.modelID === override.model.modelID
      ? previousModel.variant
      : undefined
  const variant = override.model.variant ?? previousVariant
  const appliedModel: ModelSelection = {
    providerID: override.model.providerID,
    modelID: override.model.modelID,
    ...(variant ? { variant } : {}),
  }
  if (variant) input.variant = variant
  else delete input.variant
  output.message.model = { ...appliedModel }
  override.model = appliedModel
  if (input.model) {
    input.model.providerID = override.model.providerID
    input.model.modelID = override.model.modelID
  }
  if (persistSessionModel) {
    try {
      await persistSessionModel(input.sessionID, appliedModel)
    } catch {
      await showWarning(client, directory, "The selected model was applied to this message but could not be saved for later child-session turns.")
    }
  }
}

function createSessionModelPersister(
  input: PluginInput,
): ((sessionID: string, model: ModelSelection) => Promise<void>) | undefined {
  if (!(input.serverUrl instanceof URL) || !isLoopbackHttpUrl(input.serverUrl)) {
    return undefined
  }
  const client = createV2Client({
    baseUrl: input.serverUrl.toString(),
    directory: input.directory,
    fetch: createLoopbackOnlyTransport(),
  })
  return async (sessionID, model) => {
    const result = await client.v2.session.switchModel({
      sessionID,
      model: {
        id: model.modelID,
        providerID: model.providerID,
        ...(model.variant ? { variant: model.variant } : {}),
      },
    })
    if (result.error) throw new Error("OpenCode rejected the child-session model update")
  }
}

function responseData(value: unknown): unknown {
  return isRecord(value) && "data" in value ? value.data : value
}

function overrideKey(parentSessionID: string, agentName: string): string {
  return JSON.stringify([parentSessionID, agentName])
}

function callKey(parentSessionID: string, callID: string): string {
  return JSON.stringify([parentSessionID, callID])
}

async function showWarning(client: ModelCatalogClient, directory: string, message: string): Promise<void> {
  try {
    await client.tui?.showToast({
      body: {
        title: "Model Dispatch",
        message,
        variant: "warning",
        duration: 8000,
      },
      query: { directory },
    })
  } catch {
    // The operational log still records the failure when a host has no toast surface.
  }
}
