import { constants } from "node:fs"
import { access } from "node:fs/promises"
import { fileURLToPath } from "node:url"

import { launchPickerProcess } from "../src/picker-process"
import { PICKER_SMOKE_STARTUP_TIMEOUT_MS } from "./picker-smoke-fixture"

export function pickerReadySmokeAttempts(platform: string): number {
  return platform === "win32" ? 2 : 1
}

export function shouldRetryPickerReadySmoke(
  platform: string,
  attempt: number,
  reason: string,
): boolean {
  return (
    attempt < pickerReadySmokeAttempts(platform) &&
    reason.startsWith("Picker startup timeout after ")
  )
}

async function main(): Promise<void> {
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

  await access(
    binary,
    process.platform === "win32" ? constants.F_OK : constants.X_OK,
  )
  const attempts = pickerReadySmokeAttempts(process.platform)
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
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

    if (launched.kind === "technical_failure") {
      if (
        shouldRetryPickerReadySmoke(
          process.platform,
          attempt,
          launched.reason,
        )
      ) {
        console.warn(
          `native picker ready smoke timed out on attempt ${attempt}/${attempts}; retrying once`,
        )
        await new Promise((resolve) => setTimeout(resolve, 1_000))
        continue
      }
      throw new Error(launched.reason)
    }

    launched.process.kill?.()
    await launched.process.exited
    console.log(`native picker ready smoke passed: ${binary}`)
    return
  }

  throw new Error("Native picker ready smoke exhausted all attempts")
}

if (import.meta.main) {
  await main()
}
