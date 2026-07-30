export type PickerPlatform = "linux" | "macos" | "windows"
export type PickerArchitecture = "x64" | "arm64"
export type PickerBinaryFormat = "elf" | "mach-o" | "pe"

export interface PickerTarget {
  platform: PickerPlatform
  arch: PickerArchitecture
  rustTarget: string
  assetName: string
  format: PickerBinaryFormat
  machine: number
  executable: boolean
  openCodeIntegration: "verified" | "upstream-unavailable"
}

export const PICKER_TARGETS: readonly PickerTarget[] = [
  {
    platform: "linux",
    arch: "x64",
    rustTarget: "x86_64-unknown-linux-gnu",
    assetName: "picker-linux-x64",
    format: "elf",
    machine: 0x3e,
    executable: true,
    openCodeIntegration: "verified",
  },
  {
    platform: "linux",
    arch: "arm64",
    rustTarget: "aarch64-unknown-linux-gnu",
    assetName: "picker-linux-arm64",
    format: "elf",
    machine: 0xb7,
    executable: true,
    openCodeIntegration: "verified",
  },
  {
    platform: "macos",
    arch: "arm64",
    rustTarget: "aarch64-apple-darwin",
    assetName: "picker-macos-arm64",
    format: "mach-o",
    machine: 0x0100000c,
    executable: true,
    openCodeIntegration: "verified",
  },
  {
    platform: "windows",
    arch: "x64",
    rustTarget: "x86_64-pc-windows-msvc",
    assetName: "picker-windows-x64.exe",
    format: "pe",
    machine: 0x8664,
    executable: false,
    openCodeIntegration: "verified",
  },
  {
    platform: "windows",
    arch: "arm64",
    rustTarget: "aarch64-pc-windows-msvc",
    assetName: "picker-windows-arm64.exe",
    format: "pe",
    machine: 0xaa64,
    executable: false,
    openCodeIntegration: "verified",
  },
]

export function pickerPlatformForNode(platform: string): string {
  if (platform === "win32") return "windows"
  if (platform === "darwin") return "macos"
  return platform
}

export function pickerTargetForNode(
  platform: string,
  arch: string,
): PickerTarget | undefined {
  const normalizedPlatform = pickerPlatformForNode(platform)
  return PICKER_TARGETS.find(
    (target) =>
      target.platform === normalizedPlatform && target.arch === arch,
  )
}

export function pickerTargetForRustTarget(
  rustTarget: string,
): PickerTarget | undefined {
  return PICKER_TARGETS.find((target) => target.rustTarget === rustTarget)
}

export function pickerTargetForAsset(
  assetName: string,
): PickerTarget | undefined {
  return PICKER_TARGETS.find((target) => target.assetName === assetName)
}
