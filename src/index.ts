import { homedir } from "node:os"
import { join } from "node:path"

import type { Hooks, Plugin, PluginInput } from "@opencode-ai/plugin"

import { TaskBatcher, type BatchResult, type ReadyBatch, type TaskCall } from "./batcher"
import { logDispatchFailure, logDispatchSuccess, MODEL_DISPATCH_CANCELLED, MODEL_DISPATCH_PICKER_FAILED, type PluginLogger } from "./logging"
import { shapeModelCatalog, type ModelCatalogClient, type ModelSelection, type ShapeModelCatalogResult } from "./model-catalog"
import { launchPickerProcess, type PickerDecision } from "./picker-process"
import { readSettings, type ModelDispatchSettings, type ReadSettingsResult } from "./settings"
import { applySetupDecision, shouldOpenFirstRunSetup, type SetupDecision } from "./setup"
import { createShadowAgent, type AgentDefinition, type ShadowAgent } from "./shadow-agent"
import { ShadowAgentCache, type SessionRecord, type TaskMetadata } from "./shadow-cache"

export interface PickerRequest extends ShapeModelCatalogResult {
  batchID: string
  sessionID: string
  calls: TaskCall[]
  timeoutMs: number
  theme?: PickerThemeHint
}

export interface PickerThemeHint {
  themeID?: string
  colorScheme?: "light" | "dark" | "system"
}

export interface ShadowCacheLike {
  recordBeforeTask(callID: string, shadowKey: string): Promise<void>
  recordAfterTask(callID: string, metadata: TaskMetadata): Promise<void>
  handleSessionUpdated(session: SessionRecord): Promise<void>
  dispose(): Promise<void>
}

export interface ModelDispatchPluginDeps {
  readSettings?: (input: PluginInput) => Promise<ReadSettingsResult>
  logger?: PluginLogger
  cache?: ShadowCacheLike
  scheduleBatch?: (fn: () => void, delayMs: number) => void
  launchPicker?: (request: PickerRequest) => Promise<PickerDecision>
  createShadowAgent?: (sourceAgent: AgentDefinition, model: ModelSelection) => ShadowAgent
  shouldOpenFirstRunSetup?: (input: PluginInput, settingsResult: ReadSettingsResult) => Promise<boolean>
  openFirstRunSetup?: (input: PluginInput, settings: ModelDispatchSettings) => Promise<void>
  configureModelDispatch?: (input: PluginInput, settings: ModelDispatchSettings) => Promise<string>
}

type ToolBeforeInput = { tool: string; sessionID: string; callID: string }
type ToolBeforeOutput = { args: Record<string, unknown>; warnings?: string[] }
type ToolAfterInput = { tool: string; sessionID: string; callID: string; args: Record<string, unknown> }
type ToolAfterOutput = { metadata?: TaskMetadata }

const DEFAULT_LOGGER: PluginLogger = {
  info: (entry) => console.info(JSON.stringify(entry)),
  error: (entry) => console.error(JSON.stringify(entry)),
}

export function createModelDispatchPlugin(deps: ModelDispatchPluginDeps = {}): Plugin {
  return async (input) => {
    const settingsResult = await (deps.readSettings ?? readDefaultSettings)(input)
    const settings = settingsResult.settings
    const logger = deps.logger ?? DEFAULT_LOGGER
    const cache = deps.cache ?? new ShadowAgentCache()
    const shadowAgents = new Map<string, AgentDefinition>()
    if (await shouldOpenSetup(input, settingsResult, deps)) {
      await (deps.openFirstRunSetup ?? defaultOpenFirstRunSetup)(input, settings)
    }
    const batcher = new TaskBatcher({
      batchMs: settings.dispatch.batch_ms,
      schedule: deps.scheduleBatch,
      onReady: (batch) => {
        void dispatchBatch(batch, input.client as unknown as ModelCatalogClient, settings, logger, batcher, shadowAgents, deps)
      },
    })

    const hooks: Hooks = {
      config: async (config) => {
        const target = config as { agent?: Record<string, AgentDefinition> }
        target.agent = { ...(target.agent ?? {}), ...Object.fromEntries(shadowAgents) }
      },
      event: async ({ event }) => {
        const session = readSessionFromEvent(event)
        if (session) await cache.handleSessionUpdated(session)
      },
      dispose: async () => {
        await cache.dispose()
      },
      tool: {
        configure_model_dispatch: {
          description: "Configure opencode-model-dispatch.",
          args: {},
          execute: async () => (deps.configureModelDispatch ?? defaultConfigureModelDispatch)(input, settings),
        },
      },
      "tool.execute.before": async (hookInput, hookOutput) => {
        await beforeTask(hookInput as ToolBeforeInput, hookOutput as ToolBeforeOutput, settings, batcher, cache, input.client as unknown as ModelCatalogClient, shadowAgents, deps)
      },
      "tool.execute.after": async (hookInput, hookOutput) => {
        await afterTask(hookInput as ToolAfterInput, hookOutput as ToolAfterOutput, cache)
      },
    }

    return hooks
  }
}

export const server = createModelDispatchPlugin()
export default { server }

async function beforeTask(
  input: ToolBeforeInput,
  output: ToolBeforeOutput,
  settings: ModelDispatchSettings,
  batcher: TaskBatcher,
  cache: ShadowCacheLike,
  client: ModelCatalogClient,
  shadowAgents: Map<string, AgentDefinition>,
  deps: ModelDispatchPluginDeps,
): Promise<void> {
  if (input.tool !== "task" || !settings.dispatch.enabled) return

  const originalArgs = output.args
  const result = await batcher.enqueue({ callID: input.callID, sessionID: input.sessionID, args: originalArgs })
  if (result.kind === "fallback") {
    output.warnings = ["Model dispatch picker failed; using the configured fallback model."]
    return
  }

  const sourceAgent = await resolveSourceAgent(client, originalArgs)
  if (!sourceAgent) return

  const shadow = (deps.createShadowAgent ?? createShadowAgent)(sourceAgent, result.model)
  shadowAgents.set(shadow.key, shadow.definition)
  await cache.recordBeforeTask(input.callID, shadow.key)
  output.args = { ...originalArgs, subagent_type: shadow.key }
}

async function afterTask(input: ToolAfterInput, output: ToolAfterOutput, cache: ShadowCacheLike): Promise<void> {
  if (input.tool !== "task" || !output.metadata) return
  await cache.recordAfterTask(input.callID, output.metadata)
}

async function dispatchBatch(
  batch: ReadyBatch,
  client: ModelCatalogClient,
  settings: ModelDispatchSettings,
  logger: PluginLogger,
  batcher: TaskBatcher,
  shadowAgents: Map<string, AgentDefinition>,
  deps: ModelDispatchPluginDeps,
): Promise<void> {
  const batchID = `${batch.sessionID}:${batch.calls.map((call) => call.callID).join(",")}`
  const catalog = await shapeModelCatalog({ client, sessionID: batch.sessionID, tasks: batch.calls })
  const decision = await (deps.launchPicker ?? defaultLaunchPicker)({
    ...catalog,
    batchID,
    sessionID: batch.sessionID,
    calls: batch.calls,
    timeoutMs: settings.dispatch.picker_timeout_ms,
    theme: resolvePickerTheme(settings),
  })

  if (decision.kind === "cancel") {
    for (const call of batch.calls) logCancelled(settings, logger, batchID, call)
    batcher.cancelBatch(batch.sessionID)
    return
  }

  if (decision.kind === "technical_failure") {
    for (const call of batch.calls) logPickerFailed(settings, logger, batchID, call)
    batcher.failBatch(batch.sessionID, decision.reason)
    return
  }

  const selections = selectionsFromPayload(decision.payload, batch.calls)
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
  batcher.resolveBatch(batch.sessionID, selections)

  if (shadowAgents.size < 0) throw new Error("unreachable")
}

async function defaultLaunchPicker(request: PickerRequest): Promise<PickerDecision> {
  const launched = await launchPickerProcess({ timeoutMs: request.timeoutMs, request })
  if (launched.kind === "technical_failure") return launched
  return launched.result
}

async function resolveSourceAgent(client: ModelCatalogClient, args: Record<string, unknown>): Promise<AgentDefinition | undefined> {
  const agentName = typeof args.subagent_type === "string" ? args.subagent_type : undefined
  if (!agentName) return undefined
  const agents = await client.app.agents()
  const source = agents.find((agent) => isRecord(agent) && agent.name === agentName)
  if (!isRecord(source) || typeof source.name !== "string") return undefined
  return source as AgentDefinition
}

function selectionsFromPayload(payload: unknown, calls: TaskCall[]): Array<{ callID: string; model: ModelSelection }> {
  if (!isRecord(payload)) return []
  const applyToAll = readModel(payload.applyToAll) ?? readModel(payload.applyToAllModel)
  if (applyToAll) return calls.map((call) => ({ callID: call.callID, model: applyToAll }))

  if (!Array.isArray(payload.selections)) return []
  const selections: Array<{ callID: string; model: ModelSelection }> = []
  for (const selection of payload.selections) {
    if (!isRecord(selection)) continue
    const callID = typeof selection.callID === "string" ? selection.callID : typeof selection.taskID === "string" ? selection.taskID : undefined
    if (!callID) continue
    const model = readModel(selection.model) ?? readModel(selection)
    if (model) selections.push({ callID, model })
  }
  return selections
}

function readModel(value: unknown): ModelSelection | undefined {
  if (!isRecord(value) || typeof value.providerID !== "string" || typeof value.modelID !== "string") return undefined
  return { providerID: value.providerID, modelID: value.modelID }
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

async function defaultOpenFirstRunSetup(_input: PluginInput, _settings: ModelDispatchSettings): Promise<void> {}

async function defaultConfigureModelDispatch(input: PluginInput, settings: ModelDispatchSettings): Promise<string> {
  const decision: SetupDecision = { kind: "submit", settings: { privacy: settings.privacy, dispatch: settings.dispatch }, dispatchScope: "global" }
  await applySetupDecision(settingsPaths(input), decision)
  return "Model dispatch configuration saved."
}

function settingsPaths(input: PluginInput) {
  const directory = typeof input.directory === "string" ? input.directory : process.cwd()
  return {
    globalPath: join(homedir(), ".config", "opencode", "model-dispatch.json"),
    projectPath: join(directory, ".opencode", "model-dispatch.json"),
  }
}

function resolvePickerTheme(settings: ModelDispatchSettings, env: Record<string, string | undefined> = process.env): PickerThemeHint | undefined {
  const themeID = env.OPENCODE_MODEL_DISPATCH_THEME_ID ?? settings.appearance.theme_id
  const colorScheme = normalizeColorScheme(env.OPENCODE_MODEL_DISPATCH_COLOR_SCHEME ?? settings.appearance.color_scheme)
  if (!themeID && !colorScheme) return undefined
  return { ...(themeID ? { themeID } : {}), ...(colorScheme ? { colorScheme } : {}) }
}

function normalizeColorScheme(value: string | undefined): PickerThemeHint["colorScheme"] | undefined {
  return value === "light" || value === "dark" || value === "system" ? value : undefined
}

function readSessionFromEvent(event: unknown): SessionRecord | undefined {
  const payload = isRecord(event) ? event.properties ?? event : undefined
  const session = isRecord(payload) ? payload.session ?? payload : undefined
  if (!isRecord(session) || typeof session.id !== "string") return undefined
  return { id: session.id, ...(isRecord(session.time) ? { time: session.time } : {}) }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
