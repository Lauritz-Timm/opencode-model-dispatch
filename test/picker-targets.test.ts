import { describe, expect, test } from "bun:test"

import {
  PICKER_TARGETS,
  pickerPlatformForNode,
  pickerTargetForAsset,
  pickerTargetForNode,
  pickerTargetForRustTarget,
} from "../src/picker-targets"

describe("bundled picker target matrix", () => {
  test("contains the complete release architecture contract", () => {
    expect(
      PICKER_TARGETS.map((target) => [
        target.platform,
        target.arch,
        target.assetName,
        target.rustTarget,
        target.openCodeIntegration,
      ]),
    ).toEqual([
      [
        "linux",
        "x64",
        "picker-linux-x64",
        "x86_64-unknown-linux-gnu",
        "verified",
      ],
      [
        "linux",
        "arm64",
        "picker-linux-arm64",
        "aarch64-unknown-linux-gnu",
        "verified",
      ],
      [
        "macos",
        "arm64",
        "picker-macos-arm64",
        "aarch64-apple-darwin",
        "verified",
      ],
      [
        "windows",
        "x64",
        "picker-windows-x64.exe",
        "x86_64-pc-windows-msvc",
        "verified",
      ],
      [
        "windows",
        "arm64",
        "picker-windows-arm64.exe",
        "aarch64-pc-windows-msvc",
        "verified",
      ],
    ])
  })

  test("has unique identities, assets, and Rust targets", () => {
    expect(
      new Set(
        PICKER_TARGETS.map(({ platform, arch }) => `${platform}-${arch}`),
      ).size,
    ).toBe(PICKER_TARGETS.length)
    expect(new Set(PICKER_TARGETS.map(({ assetName }) => assetName)).size).toBe(
      PICKER_TARGETS.length,
    )
    expect(new Set(PICKER_TARGETS.map(({ rustTarget }) => rustTarget)).size).toBe(
      PICKER_TARGETS.length,
    )
  })

  test("normalizes Node platforms and resolves every lookup direction", () => {
    expect(pickerPlatformForNode("win32")).toBe("windows")
    expect(pickerPlatformForNode("darwin")).toBe("macos")
    expect(pickerPlatformForNode("linux")).toBe("linux")

    for (const target of PICKER_TARGETS) {
      const nodePlatform =
        target.platform === "windows"
          ? "win32"
          : target.platform === "macos"
            ? "darwin"
            : target.platform
      expect(pickerTargetForNode(nodePlatform, target.arch)).toBe(target)
      expect(pickerTargetForRustTarget(target.rustTarget)).toBe(target)
      expect(pickerTargetForAsset(target.assetName)).toBe(target)
    }

    expect(pickerTargetForNode("linux", "ppc64")).toBeUndefined()
    expect(pickerTargetForRustTarget("unknown-target")).toBeUndefined()
    expect(pickerTargetForAsset("picker-unknown")).toBeUndefined()
  })
})
