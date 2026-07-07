import { describe, expect, test } from "bun:test"

const root = new URL("../", import.meta.url)

async function readText(path: string): Promise<string> {
  return await Bun.file(new URL(path, root)).text()
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readText(path)) as T
}

type PackageJson = {
  scripts?: Record<string, string>
  files?: string[]
  bin?: Record<string, string>
  optionalDependencies?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

describe("packaging and release assets", () => {
  test("package install path does not require Rust or Tauri", async () => {
    const pkg = await readJson<PackageJson>("package.json")

    expect(pkg.scripts?.postinstall).toBeUndefined()
    expect(pkg.scripts?.install).toBeUndefined()
    expect(pkg.scripts?.prepare).toBeUndefined()
    expect(pkg.scripts?.prepublishOnly).not.toContain("tauri")
    expect(pkg.files).toContain("dist")
    expect(pkg.files).toContain("assets")
    expect(pkg.files).toContain("bin")
    expect(pkg.files).toContain("scripts")
    expect(pkg.bin?.["opencode-model-dispatch-picker"]).toBe("./bin/picker.js")
    expect(pkg.files).not.toContain("picker/src-tauri")
    expect(JSON.stringify(pkg.dependencies ?? {})).not.toContain("tauri")
    expect(JSON.stringify(pkg.optionalDependencies ?? {})).not.toContain("tauri")
  })

  test("documents platform picker release asset download contract", async () => {
    const readme = await readText("README.md")

    expect(readme).toContain("picker-${platform}-${arch}${ext}")
    expect(readme).toContain("OPENCODE_MODEL_DISPATCH_PICKER")
    expect(readme).toContain("https://github.com/Lauritz/opencode-model-dispatch/releases/download/${version}/picker-${platform}-${arch}${ext}")
    expect(readme).toContain("No Rust or Tauri toolchain is required")
  })

  test("packaging check script verifies documentation and package manifest", async () => {
    const pkg = await readJson<PackageJson>("package.json")
    const script = await readText("scripts/check-packaging.ts")

    expect(pkg.scripts?.["check:packaging"]).toBe("bun run scripts/check-packaging.ts")
    expect(script).toContain("picker-${platform}-${arch}${ext}")
    expect(script).toContain("OPENCODE_MODEL_DISPATCH_PICKER")
    expect(script).toContain("postinstall")
    expect(script).toContain("opencode-model-dispatch-picker")
    expect(script).toContain("files")
  })

  test("picker developer scripts include native Tauri doctor and dev entrypoint", async () => {
    const pkg = await readJson<PackageJson>("package.json")
    const doctor = await readText("scripts/check-picker-dev.ts")

    expect(pkg.scripts?.["doctor:picker"]).toBe("bun run scripts/check-picker-dev.ts")
    expect(pkg.scripts?.["dev:picker:tauri"]).toBe("bun run scripts/dev-picker-tauri.ts")
    expect(doctor).toContain("cargo --version")
    expect(doctor).toContain("rustc --version")
    expect(doctor).toContain("bun run --cwd picker tauri --version")
    expect(doctor).toContain("bun run preview:picker")
    expect(await readText("scripts/dev-picker-tauri.ts")).toContain(".cargo/bin")
  })

  test("build picker script builds and copies the native Tauri release asset", async () => {
    const script = await readText("scripts/build-picker.ts")

    expect(script).toContain("dist-picker")
    expect(script).toContain("picker-${platform}-${arch}${ext}")
    expect(script).toContain("tauri")
    expect(script).toContain("build")
    expect(script).toContain("--no-bundle")
    expect(script).toContain("--ci")
    expect(script).toContain("copyFile")
    expect(script).not.toContain("placeholder")
    expect(script).toContain("vite.exe")
  })

  test("Tauri Windows build has the required icon resource", async () => {
    expect(await Bun.file(new URL("../picker/src-tauri/icons/icon.ico", import.meta.url)).exists()).toBe(true)
  })

  test("CI validates plugin tests, typecheck, picker build, and packaging checks", async () => {
    const workflow = await readText(".github/workflows/ci.yml")

    expect(workflow).toContain("bun test")
    expect(workflow).toContain("bun run typecheck")
    expect(workflow).toContain("bun run build:picker")
    expect(workflow).toContain("bun run check:packaging")
  })

  test("tagged publish workflow publishes npm package and picker assets", async () => {
    const workflow = await readText(".github/workflows/publish.yml")

    expect(workflow).toContain("tags:")
    expect(workflow).toContain("v*")
    expect(workflow).toContain("npm publish")
    expect(workflow).toContain("picker-${{ matrix.platform }}-${{ matrix.arch }}${{ matrix.ext }}")
    expect(workflow).toContain("gh release upload")
  })

  test("README documents install, config, setup, privacy, and troubleshooting", async () => {
    const readme = await readText("README.md")

    for (const heading of ["## Install", "## Configuration", "## Setup", "## Privacy", "## Troubleshooting"]) {
      expect(readme).toContain(heading)
    }
  })
})
