import type {
  BackendPickerRequestInput,
} from "../picker/src/runtime-request"

interface NativePickerSmokeRequest extends BackendPickerRequestInput {
  batchID: string
  sessionID: string
  timeoutMs: number
  theme: { colorScheme: string }
}

export const PICKER_SMOKE_STARTUP_TIMEOUT_MS = 60_000

const nativePickerSmokeCatalog: BackendPickerRequestInput["catalog"] = [{
    providerID: "openai",
    providerName: "OpenAI",
    models: [
      {
        providerID: "openai",
        providerName: "OpenAI",
        modelID: "gpt-5",
        modelName: "GPT-5",
        variants: ["low", "medium", "high"],
      },
      {
        providerID: "openai",
        providerName: "OpenAI",
        modelID: "gpt-5-mini",
        modelName: "GPT-5 mini",
        variants: ["low", "medium", "high"],
      },
    ],
  }]

export const nativePickerSmokeRequest: NativePickerSmokeRequest = {
  batchID: "native-gui-smoke",
  sessionID: "native-gui-smoke",
  timeoutMs: PICKER_SMOKE_STARTUP_TIMEOUT_MS,
  catalog: nativePickerSmokeCatalog,
  applyToAllCatalog: nativePickerSmokeCatalog,
  rows: [
    {
      callID: "builder-task",
      agentName: "builder",
    },
    {
      callID: "reviewer-task",
      agentName: "reviewer",
    },
  ],
  theme: { colorScheme: "dark" },
}

export function assertNativePickerSmokePayload(payload: unknown): void {
  const selections = (payload as {
    selections?: Array<{
      taskID?: string
      providerID?: string
      modelID?: string
      variant?: string
    }>
  }).selections
  if (!Array.isArray(selections) || selections.length !== 2) {
    throw new Error(`Expected two picker selections, received ${JSON.stringify(payload)}`)
  }
  const byTask = new Map(selections.map((selection) => [selection.taskID, selection]))
  if (
    byTask.get("builder-task")?.providerID !== "openai" ||
    byTask.get("builder-task")?.modelID !== "gpt-5" ||
    byTask.get("builder-task")?.variant !== "high" ||
    byTask.get("reviewer-task")?.providerID !== "openai" ||
    byTask.get("reviewer-task")?.modelID !== "gpt-5-mini" ||
    byTask.get("reviewer-task")?.variant !== "medium"
  ) {
    throw new Error(`Picker returned unexpected selections: ${JSON.stringify(payload)}`)
  }
}
