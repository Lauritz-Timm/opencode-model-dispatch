import type { ModelDispatchSettings } from "./settings"

export const MODEL_DISPATCH_CANCELLED = "MODEL_DISPATCH_CANCELLED"
export const MODEL_DISPATCH_PICKER_FAILED = "MODEL_DISPATCH_PICKER_FAILED"

export type DispatchFailureCode = typeof MODEL_DISPATCH_CANCELLED | typeof MODEL_DISPATCH_PICKER_FAILED
export type DispatchFailureCategory = "user_cancelled" | "technical_failure"

export type PluginLogEntry = DispatchSuccessLogEntry | DispatchFailureLogEntry

export interface DispatchSuccessTelemetry {
  batchID: string
  callIDs: string[]
  sessionID: string
  platform: string
  pickerVersion: string
  ipcStatus: string
  processStatus: string
  selectedCount: number
}

export interface DispatchFailureTelemetry {
  code: DispatchFailureCode
  category: DispatchFailureCategory
  batchID: string
  callID: string
  sessionID: string
  platform: string
  pickerVersion: string
  ipcStatus: string
  processStatus: string
}

export interface DispatchSuccessLogEntry extends DispatchSuccessTelemetry {
  event: "model_dispatch_success"
}

export interface DispatchFailureLogEntry extends DispatchFailureTelemetry {
  event: "model_dispatch_failure"
}

export interface PluginLogger {
  info(entry: PluginLogEntry): void
  error(entry: PluginLogEntry): void
}

export function logDispatchSuccess(settings: ModelDispatchSettings, logger: PluginLogger, telemetry: DispatchSuccessTelemetry): { warnings: string[] } {
  if (settings.privacy.logging_enabled) {
    logger.info({
      event: "model_dispatch_success",
      batchID: telemetry.batchID,
      callIDs: telemetry.callIDs,
      sessionID: telemetry.sessionID,
      platform: telemetry.platform,
      pickerVersion: telemetry.pickerVersion,
      ipcStatus: telemetry.ipcStatus,
      processStatus: telemetry.processStatus,
      selectedCount: telemetry.selectedCount,
    })
  }

  return { warnings: [] }
}

export function logDispatchFailure(
  settings: ModelDispatchSettings,
  logger: PluginLogger,
  telemetry: DispatchFailureTelemetry,
): { warnings: string[] } | { errors: string[] } {
  if (settings.privacy.logging_enabled) {
    logger.error({
      event: "model_dispatch_failure",
      code: telemetry.code,
      category: telemetry.category,
      batchID: telemetry.batchID,
      callID: telemetry.callID,
      sessionID: telemetry.sessionID,
      platform: telemetry.platform,
      pickerVersion: telemetry.pickerVersion,
      ipcStatus: telemetry.ipcStatus,
      processStatus: telemetry.processStatus,
    })
  }

  if (telemetry.code === MODEL_DISPATCH_CANCELLED) return { errors: ["Model selection cancelled"] }
  return { warnings: ["Model dispatch picker failed; using the configured fallback model."] }
}
