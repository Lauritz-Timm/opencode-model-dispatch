import { encodeJsonRpc, type JsonRpcMessage } from "./protocol"
import type { ModelSelectionSubmitParams } from "./model-selection-reducer"
import { modelSelectionInputFromPickerRequest, type BackendPickerRequestInput, type PickerRuntimeRequest, type PickerSetupInput, type PickerThemeHint } from "./runtime-request"

const PICKER_RPC_EVENT = "picker-rpc-message"
const WRITE_STDOUT_COMMAND = "write_stdout_line"

export type RuntimeEventHandler = (event: { payload: unknown }) => void
export type RuntimeUnlisten = () => void

export interface PickerRuntimeAdapterDependencies {
  listen: (event: string, handler: RuntimeEventHandler) => Promise<RuntimeUnlisten>
  writeStdoutLine: (line: string) => Promise<void>
}

export interface PickerRuntimeAdapter {
  start: (onStart: (request: PickerRuntimeRequest) => void) => Promise<RuntimeUnlisten>
  submit: (params: ModelSelectionSubmitParams) => Promise<void>
  cancel: () => Promise<void>
}

export function createPickerRuntimeAdapter(dependencies: PickerRuntimeAdapterDependencies): PickerRuntimeAdapter {
  return {
    async start(onStart) {
      const unlisten = await dependencies.listen(PICKER_RPC_EVENT, (event) => {
        if (typeof event.payload !== "string") return
        const request = pickerRuntimeRequestFromLine(event.payload)
        if (request) onStart(request)
      })

      await dependencies.writeStdoutLine(encodeJsonRpc({ jsonrpc: "2.0", method: "ready" }).trimEnd())
      return unlisten
    },
    async submit(params) {
      await dependencies.writeStdoutLine(encodeJsonRpc({ jsonrpc: "2.0", method: "submit", params }).trimEnd())
    },
    async cancel() {
      await dependencies.writeStdoutLine(encodeJsonRpc({ jsonrpc: "2.0", method: "cancel" }).trimEnd())
    },
  }
}

export async function createTauriPickerRuntimeAdapter(): Promise<PickerRuntimeAdapter> {
  const [{ listen }, { invoke }] = await Promise.all([import("@tauri-apps/api/event"), import("@tauri-apps/api/core")])
  return createPickerRuntimeAdapter({
    listen,
    writeStdoutLine: (line) => invoke(WRITE_STDOUT_COMMAND, { line }),
  })
}

export function pickerRuntimeRequestFromLine(line: string): PickerRuntimeRequest | undefined {
  let message: JsonRpcMessage
  try {
    message = JSON.parse(line) as JsonRpcMessage
  } catch {
    return undefined
  }

  if (message.jsonrpc !== "2.0" || message.method !== "start") return undefined
  return pickerRuntimeRequestFromStartParams(message.params)
}

function pickerRuntimeRequestFromStartParams(params: unknown): PickerRuntimeRequest | undefined {
  if (!isRecord(params)) return undefined

  const theme = readThemeHint(params.theme)
  const setup = readSetup(params)
  const modelSelection = readModelSelection(params)
  if (!theme && !setup && !modelSelection) return undefined

  return { ...(theme ? { theme } : {}), ...(modelSelection ? { modelSelection } : {}), ...(setup ? { setup } : {}) }
}

function readModelSelection(value: Record<string, unknown>) {
  if (!Array.isArray(value.catalog) || !Array.isArray(value.applyToAllCatalog) || !Array.isArray(value.rows)) return undefined
  return modelSelectionInputFromPickerRequest(value as unknown as BackendPickerRequestInput)
}

function readSetup(value: Record<string, unknown>): PickerSetupInput | undefined {
  if (!isRecord(value.settings)) return undefined
  const scope = value.scope === "project" || value.scope === "global" ? value.scope : undefined
  return { settings: value.settings as unknown as PickerSetupInput["settings"], ...(scope ? { scope } : {}) }
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
