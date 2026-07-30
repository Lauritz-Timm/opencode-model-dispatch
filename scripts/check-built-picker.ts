import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

import {
  releasePickerAssetFailures,
  releasePickerAssets,
} from "./check-packaging"
import { pickerTargetForNode } from "../src/picker-targets"

const target = pickerTargetForNode(process.platform, process.arch)
if (!target) {
  throw new Error(
    `No supported picker target matches ${process.platform}-${process.arch}`,
  )
}

const expectedPlatform =
  process.env.MODEL_DISPATCH_EXPECTED_PICKER_PLATFORM
const expectedArch = process.env.MODEL_DISPATCH_EXPECTED_PICKER_ARCH
if (
  (expectedPlatform && !expectedArch) ||
  (!expectedPlatform && expectedArch)
) {
  throw new Error(
    "MODEL_DISPATCH_EXPECTED_PICKER_PLATFORM and MODEL_DISPATCH_EXPECTED_PICKER_ARCH must be set together",
  )
}
if (
  expectedPlatform &&
  expectedArch &&
  (target.platform !== expectedPlatform || target.arch !== expectedArch)
) {
  throw new Error(
    `Expected native picker host ${expectedPlatform}-${expectedArch}, received ${target.platform}-${target.arch}`,
  )
}

const rustc = spawnSync("rustc", ["-vV"], {
  encoding: "utf8",
  shell: false,
})
if (rustc.error) throw rustc.error
if (rustc.status !== 0) {
  throw new Error(
    `rustc -vV failed with exit code ${rustc.status}: ${rustc.stderr.trim()}`,
  )
}
const rustHost = /^host:\s+(\S+)\s*$/m.exec(rustc.stdout)?.[1]
if (rustHost !== target.rustTarget) {
  throw new Error(
    `Expected native Rust host ${target.rustTarget}, received ${rustHost ?? "unknown"}`,
  )
}

const asset = releasePickerAssets.find(
  (candidate) => candidate.name === target.assetName,
)
if (!asset) {
  throw new Error(`Missing release asset contract for ${target.assetName}`)
}

const assetRoot = new URL("../dist-picker/", import.meta.url)
const failures = await releasePickerAssetFailures(assetRoot, [asset], "dist-picker")
if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`picker host check failed: ${failure}`)
  }
  process.exit(1)
}

console.log(
  `picker host check passed: ${fileURLToPath(new URL(asset.name, assetRoot))} is ${target.platform}-${target.arch} ${asset.format}`,
)
