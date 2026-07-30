import { access } from "node:fs/promises"
import { constants } from "node:fs"
import { fileURLToPath } from "node:url"

import { launchPickerProcess } from "../src/picker-process"
import { PICKER_SMOKE_STARTUP_TIMEOUT_MS } from "./picker-smoke-fixture"

const platform =
  process.platform === "win32"
    ? "windows"
    : process.platform === "darwin"
      ? "macos"
      : process.platform
const extension = platform === "windows" ? ".exe" : ""
const binary =
  process.env.OPENCODE_MODEL_DISPATCH_PICKER ??
  fileURLToPath(
    new URL(
      `../dist-picker/picker-${platform}-${process.arch}${extension}`,
      import.meta.url,
    ),
  )

await access(binary, process.platform === "win32" ? constants.F_OK : constants.X_OK)
const launched = await launchPickerProcess({
  env: { OPENCODE_MODEL_DISPATCH_PICKER: binary },
  timeoutMs: PICKER_SMOKE_STARTUP_TIMEOUT_MS,
  request: {
    batchID: "native-ready-smoke",
    sessionID: "native-ready-smoke",
    timeoutMs: PICKER_SMOKE_STARTUP_TIMEOUT_MS,
    catalog: [{
      providerID: "openai",
      providerName: "OpenAI",
      models: [{
        providerID: "openai",
        providerName: "OpenAI",
        modelID: "smoke",
        modelName: "Native ready smoke",
        variants: [],
      }],
    }],
    applyToAllCatalog: [],
    rows: [{ callID: "smoke-task", agentName: "builder" }],
  },
})

if (launched.kind === "technical_failure") throw new Error(launched.reason)
launched.process.kill?.()
await launched.process.exited
console.log(`native picker ready smoke passed: ${binary}`)
