import { fileURLToPath } from "node:url"

import { nativeE2EPreparationMode } from "./installed-native-opencode-support"

const root = fileURLToPath(new URL("../", import.meta.url))

if (import.meta.main) {
  const useTui = process.argv.slice(2).includes("--tui")
  const mode = nativeE2EPreparationMode(process.env)
  if (mode === "build-local") {
    console.log(
      "Preparing fresh plugin and native-picker artifacts for the local installed-package integration...",
    )
    await run([process.execPath, "run", "build"])
    await run([process.execPath, "run", "build:picker"])
  } else if (mode === "exact-tarball") {
    console.log(
      "Using the supplied exact package tarball; local build steps are intentionally skipped.",
    )
  } else {
    console.log("Using explicitly prebuilt local integration artifacts.")
  }

  await run(
    [process.execPath, "run", "scripts/test-installed-native-opencode.ts"],
    {
      ...process.env,
      MODEL_DISPATCH_TEST_PREBUILT: "1",
      MODEL_DISPATCH_TEST_TUI: useTui ? "1" : undefined,
    },
  )
}

async function run(
  command: string[],
  environment: Record<string, string | undefined> = process.env,
): Promise<void> {
  const child = Bun.spawn(command, {
    cwd: root,
    env: environment,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  })
  const code = await child.exited
  if (code !== 0) {
    throw new Error(`${command.join(" ")} failed with exit code ${code}`)
  }
}
