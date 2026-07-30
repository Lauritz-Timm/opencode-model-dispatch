#!/usr/bin/env node

import { spawn } from "node:child_process"
import { dirname, isAbsolute, join } from "node:path"
import { fileURLToPath } from "node:url"

const platform = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : process.platform
const extension = platform === "windows" ? ".exe" : ""
const packagedPicker = join(dirname(fileURLToPath(import.meta.url)), `picker-${platform}-${process.arch}${extension}`)
const override = process.env.OPENCODE_MODEL_DISPATCH_PICKER

if (override && !isAbsolute(override)) {
  console.error(
    "OPENCODE_MODEL_DISPATCH_PICKER must be an absolute path to an operator-trusted binary",
  )
  process.exitCode = 1
} else {
  const picker = override || packagedPicker
  const child = spawn(picker, process.argv.slice(2), { stdio: "inherit" })

  child.once("error", (error) => {
    console.error(`Unable to start the model dispatch picker at ${picker}: ${error.message}`)
    process.exitCode = 1
  })
  child.once("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal)
    else process.exitCode = code ?? 1
  })
}
