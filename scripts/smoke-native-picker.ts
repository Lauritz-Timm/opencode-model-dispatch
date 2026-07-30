import { access } from "node:fs/promises"
import { fileURLToPath } from "node:url"

import { launchPickerProcess } from "../src/picker-process"
import { assertNativePickerSmokePayload, nativePickerSmokeRequest } from "./picker-smoke-fixture"

const platform = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : process.platform
const extension = platform === "windows" ? ".exe" : ""
const binary = fileURLToPath(new URL(`../dist-picker/picker-${platform}-${process.arch}${extension}`, import.meta.url))

await access(binary)
console.log(
  "The native picker is opening with two unselected rows. "
  + "Set Apply to all Model to GPT-5 mini and Effort to High, "
  + "then click “Start tasks” within 10 minutes; Cancel is treated as a failed smoke test.",
)

const launched = await launchPickerProcess({
  env: { OPENCODE_MODEL_DISPATCH_PICKER: binary },
  timeoutMs: 20_000,
  request: nativePickerSmokeRequest,
})

if (launched.kind === "technical_failure") throw new Error(launched.reason)
const decision = await launched.result
if (decision.kind !== "submit") throw new Error(decision.kind === "cancel" ? "Picker smoke test was cancelled" : decision.reason)

assertNativePickerSmokePayload(decision.payload)
console.log("native GUI smoke passed: picker returned model and effort selections through the production stdio protocol")
