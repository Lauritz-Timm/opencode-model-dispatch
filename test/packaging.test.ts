import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import {
  releasePackageFileFailures,
  releasePickerAssetFailures,
  releasePickerAssets,
} from "../scripts/check-packaging"
import {
  pickerReadySmokeAttempts,
  shouldRetryPickerReadySmoke,
} from "../scripts/smoke-picker-ready"
import { PICKER_TARGETS, pickerTargetForAsset } from "../src/picker-targets"

const root = new URL("../", import.meta.url)

async function readText(path: string): Promise<string> {
  return await Bun.file(new URL(path, root)).text()
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readText(path)) as T
}

async function sha256(path: string): Promise<string> {
  const bytes = await Bun.file(new URL(path, root)).arrayBuffer()
  return createHash("sha256").update(new Uint8Array(bytes)).digest("hex")
}

type PackageJson = {
  scripts?: Record<string, string>
  files?: string[]
  bin?: Record<string, string>
  engines?: Record<string, string>
  optionalDependencies?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
}

function nativeExecutableFixture(assetName: string): Uint8Array {
  const target = pickerTargetForAsset(assetName)
  if (!target) throw new Error(`Missing picker target for ${assetName}`)

  const content = new Uint8Array(128)
  const view = new DataView(content.buffer)
  if (target.format === "elf") {
    content.set([0x7f, 0x45, 0x4c, 0x46, 2, 1])
    view.setUint16(18, target.machine, true)
  } else if (target.format === "mach-o") {
    content.set([0xcf, 0xfa, 0xed, 0xfe])
    view.setUint32(4, target.machine, true)
  } else {
    content.set([0x4d, 0x5a])
    view.setUint32(0x3c, 0x40, true)
    content.set([0x50, 0x45, 0x00, 0x00], 0x40)
    view.setUint16(0x44, target.machine, true)
  }
  return content
}

function workflowMatrixTarget(platform: string, arch: string): string {
  return `platform: ${platform}\n            arch: ${arch}`
}

function pickerArtifactName(assetName: string): string {
  return assetName.replace(/\.exe$/, "")
}

describe("packaging and release assets", () => {
  test("package install path does not require Rust or Tauri", async () => {
    const pkg = await readJson<PackageJson>("package.json")
    const launcher = await readText("bin/picker.js")

    expect(pkg.scripts?.postinstall).toBeUndefined()
    expect(pkg.scripts?.install).toBeUndefined()
    expect(pkg.scripts?.prepare).toBeUndefined()
    expect(pkg.scripts?.prepublishOnly).not.toContain("tauri")
    expect(pkg.files).toContain("dist")
    expect(pkg.files).not.toContain("assets")
    expect(pkg.files).toContain("bin")
    expect(pkg.files).not.toContain("scripts")
    expect(pkg.files).toContain("THIRD_PARTY_NOTICES.md")
    expect(pkg.files).not.toContain("docs/manual-integration-gate.md")
    expect(pkg.bin?.["opencode-model-dispatch-picker"]).toBe("./bin/picker.js")
    expect(pkg.files).not.toContain("picker/src-tauri")
    expect(JSON.stringify(pkg.dependencies ?? {})).not.toContain("tauri")
    expect(JSON.stringify(pkg.optionalDependencies ?? {})).not.toContain("tauri")
    expect(pkg.engines?.node).toBe(">=18")
    expect(pkg.engines?.opencode).toBe(">=1.18.7 <2")
    expect(pkg.peerDependencies?.["@opencode-ai/plugin"]).toBe(
      ">=1.18.7 <2",
    )
    expect(pkg.peerDependenciesMeta?.["@opencode-ai/plugin"]).toBeUndefined()
    expect(await Bun.file(new URL("../.npmignore", import.meta.url)).exists()).toBe(true)
    expect(launcher).toContain("isAbsolute")
    expect(launcher).toContain(
      "OPENCODE_MODEL_DISPATCH_PICKER must be an absolute path",
    )
  })

  test("documents platform picker release asset download contract", async () => {
    const readme = await readText("README.md")

    expect(readme).toContain("picker-${platform}-${arch}${ext}")
    expect(readme).toContain("OPENCODE_MODEL_DISPATCH_PICKER")
    expect(readme).toContain("https://github.com/Lauritz-Timm/opencode-model-dispatch/releases/download/v${version}/picker-${platform}-${arch}${ext}")
    expect(readme).toContain("No Rust or Tauri toolchain is required")
  })

  test("packaging check script verifies documentation and package manifest", async () => {
    const pkg = await readJson<PackageJson>("package.json")
    const script = await readText("scripts/check-packaging.ts")

    expect(pkg.scripts?.["check:packaging"]).toBe("bun run scripts/check-packaging.ts")
    expect(pkg.scripts?.["check:release-ci"]).toBe("bun run scripts/check-release-ci.ts")
    expect(pkg.scripts?.["check:release-version"]).toBe("bun run scripts/check-release-version.ts")
    expect(pkg.scripts?.["check:release-package"]).toContain("--require-all-pickers")
    expect(pkg.scripts?.["release:candidate-preflight"]).toContain("check:packaging")
    expect(pkg.scripts?.["release:candidate-preflight"]).not.toContain("check:public-repo")
    expect(pkg.scripts?.["release:candidate-preflight"]).not.toContain("check:release-package")
    expect(pkg.scripts?.["release:preflight"]).toBe(
      "bun run release:candidate-preflight && bun run check:manual-gate",
    )
    expect(pkg.scripts?.["release:artifact-preflight"]).toContain("check:release-package")
    expect(pkg.scripts?.prepublishOnly).toContain("check:release-package")
    expect(script).toContain("picker-${platform}-${arch}${ext}")
    expect(script).toContain("OPENCODE_MODEL_DISPATCH_PICKER")
    expect(script).toContain("postinstall")
    expect(script).toContain("opencode-model-dispatch-picker")
    expect(script).toContain("files")
  })

  test("release packaging validates native binary magic, size, and Unix modes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "model-dispatch-assets-"))
    const assetRoot = pathToFileURL(`${directory}/`)
    try {
      for (const asset of releasePickerAssets) {
        const path = join(directory, asset.name)
        await writeFile(path, nativeExecutableFixture(asset.name))
        if (asset.executable) await chmod(path, 0o755)
      }

      expect(await releasePickerAssetFailures(assetRoot)).toEqual([])

      await writeFile(
        join(directory, "picker-windows-x64.exe"),
        new Uint8Array(128),
      )
      await chmod(join(directory, "picker-macos-arm64"), 0o644)

      const failures = await releasePickerAssetFailures(assetRoot)
      expect(failures).toContain(
        "bin/picker-macos-arm64 must have a Unix executable mode",
      )
      expect(failures.some((failure) => failure.includes("must have PE binary magic"))).toBe(true)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("release packaging rejects an architecture mismatch for every target", async () => {
    for (const asset of releasePickerAssets) {
      const directory = await mkdtemp(
        join(tmpdir(), "model-dispatch-wrong-arch-"),
      )
      const assetRoot = pathToFileURL(`${directory}/`)
      try {
        for (const candidate of releasePickerAssets) {
          const content = nativeExecutableFixture(candidate.name)
          if (candidate.name === asset.name) {
            const target = pickerTargetForAsset(candidate.name)!
            const view = new DataView(content.buffer)
            if (target.format === "elf") {
              view.setUint16(18, target.machine === 0x3e ? 0xb7 : 0x3e, true)
            } else if (target.format === "mach-o") {
              view.setUint32(4, 0x01000007, true)
            } else {
              view.setUint16(
                0x44,
                target.machine === 0x8664 ? 0xaa64 : 0x8664,
                true,
              )
            }
          }
          const path = join(directory, candidate.name)
          await writeFile(path, content)
          if (candidate.executable) await chmod(path, 0o755)
        }

        const failures = await releasePickerAssetFailures(assetRoot)
        expect(
          failures.some(
            (failure) =>
              failure.includes(`bin/${asset.name}`) &&
              failure.includes("must target"),
          ),
        ).toBe(true)
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    }
  })

  test("strict release packaging requires all picker assets in npm pack output", () => {
    const files = [
      { path: "bin/picker.js", mode: 0o755 },
      ...releasePickerAssets.map((asset) => ({
        path: `bin/${asset.name}`,
        mode: asset.executable ? 0o755 : 0o644,
      })),
    ]

    expect(releasePackageFileFailures([{ files }])).toEqual([])
    expect(releasePackageFileFailures({
      "opencode-model-dispatch": { files },
    })).toEqual([])
    expect(releasePackageFileFailures([{
      files: files.filter(
        (file) => file.path !== "bin/picker-windows-x64.exe",
      ),
    }])).toEqual([
      "staged npm package must contain bin/picker-windows-x64.exe",
    ])
    expect(releasePackageFileFailures([{
      files: files.map((file) =>
        file.path === "bin/picker-macos-arm64"
          ? { ...file, mode: 0o644 }
          : file
      ),
    }])).toEqual([
      "staged npm package bin/picker-macos-arm64 must have tar mode 0755; received 0644",
    ])
    expect(releasePackageFileFailures([{
      files: [...files, { path: "bin/debug-symbols.txt", mode: 0o644 }],
    }])).toEqual([
      "staged npm package must not contain unexpected bin/debug-symbols.txt",
    ])
  })

  test("npm really packs generated picker assets ignored by Git", async () => {
    const directory = await mkdtemp(join(tmpdir(), "model-dispatch-npm-pack-"))
    try {
      const bin = join(directory, "bin")
      await mkdir(bin)
      await writeFile(join(directory, "package.json"), JSON.stringify({
        name: "model-dispatch-pack-fixture",
        version: "1.0.0",
        files: ["bin"],
        bin: { fixture: "./bin/picker.js" },
      }))
      await writeFile(
        join(directory, ".gitignore"),
        `${releasePickerAssets.map((asset) => `/bin/${asset.name}`).join("\n")}\n`,
      )
      await writeFile(
        join(directory, ".npmignore"),
        "# package.json files is authoritative\n",
      )
      await writeFile(join(bin, "picker.js"), "#!/usr/bin/env node\n")
      await chmod(join(bin, "picker.js"), 0o755)
      for (const asset of releasePickerAssets) {
        await writeFile(join(bin, asset.name), new Uint8Array(128))
        if (asset.executable) await chmod(join(bin, asset.name), 0o755)
      }

      const child = Bun.spawnSync(
        ["npm", "pack", "--json", "--dry-run", "--ignore-scripts"],
        {
          cwd: directory,
          env: {
            ...process.env,
            npm_config_cache: join(directory, "npm-cache"),
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      )
      const exitCode = child.exitCode
      const stdout = child.stdout.toString()
      const stderr = child.stderr.toString()
      expect(exitCode, stderr).toBe(0)
      expect(releasePackageFileFailures(JSON.parse(stdout) as unknown)).toEqual([])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
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
    expect(script).toContain("pickerTarget.assetName")
    expect(script).toContain("MODEL_DISPATCH_PICKER_RUST_TARGET")
    expect(script).toContain('"--target"')
    expect(script).toContain("tauri")
    expect(script).toContain("build")
    expect(script).toContain("--no-bundle")
    expect(script).toContain("--ci")
    expect(script).toContain("copyFile")
    expect(script).not.toContain("placeholder")
    expect(script).toContain("vite.exe")
  })

  test("Tauri keeps only transparent compiler-required icon resources", async () => {
    expect(await sha256("picker/src-tauri/icons/icon.png"))
      .toBe("ba055962ae121382fb500212d29d0e29e681aa96f691a715cf9fa520a95970ae")
    expect(await sha256("picker/src-tauri/icons/icon.ico"))
      .toBe("1698728788d4f5600f8e5561b62b712693224e92339d23150c03d744c014ff19")
    expect(await Bun.file(new URL("picker/public/assets", root)).exists()).toBe(false)
  })

  test("CI validates every supported picker OS and architecture independently", async () => {
    const workflow = await readText(".github/workflows/ci.yml")
    const headlessWrapper = await readText("scripts/run-with-openbox.sh")
    const nodeConsumer = await readText("scripts/test-node-consumer.mjs")
    const packageManifest = await readJson<PackageJson>("package.json")
    const hostCheck = await readText("scripts/check-built-picker.ts")
    const nodeConsumerJob = workflow.slice(
      workflow.indexOf("\n  node-consumer:"),
      workflow.indexOf("\n  opencode-integration:"),
    )
    const x64PickerJob = workflow.slice(
      workflow.indexOf("\n  picker-build:"),
      workflow.indexOf("\n  picker-build-arm64:"),
    )
    const arm64PickerJob = workflow.slice(
      workflow.indexOf("\n  picker-build-arm64:"),
      workflow.indexOf("\n  picker-build-nonlinux:"),
    )
    const nonLinuxPickerJob = workflow.slice(
      workflow.indexOf("\n  picker-build-nonlinux:"),
      workflow.indexOf("\n  packaging:"),
    )
    const packagingJob = workflow.slice(workflow.indexOf("\n  packaging:"))

    expect(workflow).toContain("bun test")
    expect(workflow).toContain("bun run typecheck")
    expect(workflow).toContain("bun run build:picker")
    expect(workflow).toContain("bun run test:picker:rendered")
    expect(workflow).toContain("bun run check:packaging")
    expect(workflow).toContain("bun run check:release-version")
    expect(nodeConsumerJob).toContain("name: Node ${{ matrix.node }} package consumer")
    expect(nodeConsumerJob).toContain('node: ["18", "22"]')
    expect(nodeConsumerJob).toContain("node-version: ${{ matrix.node }}")
    expect(nodeConsumerJob).toContain("bun run build")
    expect(nodeConsumerJob).toContain("node scripts/test-node-consumer.mjs")
    expect(nodeConsumer).toContain('"--offline"')
    expect(nodeConsumer).toContain('"--legacy-peer-deps"')
    expect(nodeConsumer).toContain(
      'npm_config_registry: "http://127.0.0.1:9"',
    )
    expect(nodeConsumer).toContain(
      'join(root, "node_modules", "@opencode-ai", "plugin")',
    )
    expect(workflow).toContain(
      "rustup toolchain install 1.97.1 --profile minimal --no-self-update",
    )
    expect(workflow).toContain(
      "cargo install cargo-audit --version 0.22.2 --locked",
    )
    expect(workflow).toContain(
      "cargo audit --file picker/src-tauri/Cargo.lock",
    )
    expect(workflow).toContain("libwebkit2gtk-4.1-dev")
    expect(workflow).toContain("smoke-native-picker-auto.ts")
    expect(workflow).toContain("bun run test:package:native:tui")
    expect(workflow).toContain("bash scripts/run-with-openbox.sh")
    expect(workflow).toContain("x11-utils")
    expect(workflow).toContain('LIBGL_ALWAYS_SOFTWARE: "1"')
    expect(workflow).toContain('WEBKIT_DISABLE_COMPOSITING_MODE: "1"')
    expect(workflow).toContain('WEBKIT_DISABLE_DMABUF_RENDERER: "1"')
    expect(workflow).toContain("xdotool")
    expect(workflow).toContain("runs-on: ubuntu-22.04")
    expect(x64PickerJob).toContain("name: Picker build (Linux x64)")
    expect(x64PickerJob).toContain("MODEL_DISPATCH_EXPECTED_PICKER_PLATFORM: linux")
    expect(x64PickerJob).toContain("MODEL_DISPATCH_EXPECTED_PICKER_ARCH: x64")
    expect(x64PickerJob).toContain("bun run check:picker-host")
    expect(arm64PickerJob).toContain("runs-on: ubuntu-22.04-arm")
    expect(arm64PickerJob).toContain("name: Picker build (Linux ARM64)")
    expect(arm64PickerJob).toContain('test "$(uname -m)" = "aarch64"')
    expect(arm64PickerJob).toContain("process.stdout.write(process.arch)")
    expect(arm64PickerJob).toContain("picker-linux-arm64")
    expect(arm64PickerJob).toContain("Machine:[[:space:]]+AArch64")
    expect(arm64PickerJob).toContain("bun run test:picker-ready")
    expect(arm64PickerJob).toContain("smoke-native-picker-auto.ts")
    expect(arm64PickerJob).toContain("bun run test:package:native:opencode")
    expect(arm64PickerJob).toContain("bun run test:package:native:tui")
    expect(arm64PickerJob).not.toContain("continue-on-error")
    expect(nonLinuxPickerJob).toContain("name: Picker build (${{ matrix.label }})")
    expect(nonLinuxPickerJob).toContain("runs-on: ${{ matrix.runner }}")
    expect(nonLinuxPickerJob).toContain("fail-fast: false")
    expect(nonLinuxPickerJob).toContain("label: macOS ARM64")
    expect(nonLinuxPickerJob).toContain("runner: macos-15")
    expect(nonLinuxPickerJob).toContain("label: Windows x64")
    expect(nonLinuxPickerJob).toContain("runner: windows-2025")
    expect(nonLinuxPickerJob).toContain("label: Windows ARM64")
    expect(nonLinuxPickerJob).toContain("runner: windows-11-arm")
    expect(nonLinuxPickerJob).toContain("bun run check:picker-host")
    expect(nonLinuxPickerJob).toContain(
      "MODEL_DISPATCH_EXPECTED_PICKER_PLATFORM: ${{ matrix.platform }}",
    )
    expect(nonLinuxPickerJob).toContain(
      "MODEL_DISPATCH_EXPECTED_PICKER_ARCH: ${{ matrix.arch }}",
    )
    expect(nonLinuxPickerJob).toContain(
      "cargo test --manifest-path picker/src-tauri/Cargo.toml --locked",
    )
    expect(nonLinuxPickerJob).toContain("bun run test:picker-ready")
    expect(nonLinuxPickerJob).not.toContain("continue-on-error")
    expect(packageManifest.scripts?.["check:picker-host"]).toBe(
      "bun run scripts/check-built-picker.ts",
    )
    expect(hostCheck).toContain("pickerTargetForNode(process.platform, process.arch)")
    expect(hostCheck).toContain("target.rustTarget")
    expect(hostCheck).toContain(
      'releasePickerAssetFailures(assetRoot, [asset], "dist-picker")',
    )
    expect(packagingJob).toContain(
      'devDependencies["@opencode-ai/plugin"]',
    )
    expect(packagingJob).toContain(
      '"@opencode-ai/plugin@$peer_version" "./$pkg"',
    )
    expect(packagingJob).toContain("--package-lock=false")
    expect(workflow).not.toContain("- run: bun install\n        working-directory: picker")
    expect(headlessWrapper).toContain("openbox --sm-disable")
    expect(headlessWrapper).toContain("_NET_SUPPORTING_WM_CHECK")
    expect(headlessWrapper).toContain('kill -0 "$openbox_pid"')
    expect(headlessWrapper).toContain('"$@"')
  })

  test("Windows ready smoke retries only a startup timeout once", async () => {
    const readySmoke = await readText("scripts/smoke-picker-ready.ts")

    expect(pickerReadySmokeAttempts("win32")).toBe(2)
    expect(pickerReadySmokeAttempts("linux")).toBe(1)
    expect(pickerReadySmokeAttempts("darwin")).toBe(1)
    expect(
      shouldRetryPickerReadySmoke(
        "win32",
        1,
        "Picker startup timeout after 60000ms",
      ),
    ).toBe(true)
    expect(
      shouldRetryPickerReadySmoke(
        "win32",
        2,
        "Picker startup timeout after 60000ms",
      ),
    ).toBe(false)
    expect(
      shouldRetryPickerReadySmoke("win32", 1, "Picker lost stdio before ready"),
    ).toBe(false)
    expect(
      shouldRetryPickerReadySmoke(
        "linux",
        1,
        "Picker startup timeout after 60000ms",
      ),
    ).toBe(false)
    expect(readySmoke).toContain("retrying once")
  })

  test("exact-tarball smoke launches the installed npm wrapper before the native picker", async () => {
    const smoke = await readText("scripts/smoke-installed-picker-tarball.ts")

    expect(smoke).toContain('join(packageRoot, "bin", "picker.js")')
    expect(smoke).toContain("spawn(process.execPath, [launcher]")
    expect(smoke).toContain("command[0] !== binary")
    expect(smoke).not.toContain(
      "env: { OPENCODE_MODEL_DISPATCH_PICKER: binary }",
    )
  })

  test("tagged publish workflow publishes npm package and picker assets", async () => {
    const workflow = await readText(".github/workflows/publish.yml")
    const notaryValidator = await readText(
      "scripts/validate-apple-notary-log.swift",
    )
    const validateJob = workflow.slice(
      workflow.indexOf("\n  validate:"),
      workflow.indexOf("\n  picker-unsigned:"),
    )
    const unsignedPickerJob = workflow.slice(
      workflow.indexOf("\n  picker-unsigned:"),
      workflow.indexOf("\n  picker-linux-integration:"),
    )
    const linuxIntegrationJob = workflow.slice(
      workflow.indexOf("\n  picker-linux-integration:"),
      workflow.indexOf("\n  picker-sign-macos:"),
    )
    const macosSigningJob = workflow.slice(
      workflow.indexOf("\n  picker-sign-macos:"),
      workflow.indexOf("\n  picker-sign-windows:"),
    )
    const windowsSigningJob = workflow.slice(
      workflow.indexOf("\n  picker-sign-windows:"),
      workflow.indexOf("\n  stage-release:"),
    )
    const stageJob = workflow.slice(
      workflow.indexOf("\n  stage-release:"),
      workflow.indexOf("\n  npm-package:"),
    )
    const packageJob = workflow.slice(
      workflow.indexOf("\n  npm-package:"),
      workflow.indexOf("\n  npm-native-smoke:"),
    )
    const nativeSmokeJob = workflow.slice(
      workflow.indexOf("\n  npm-native-smoke:"),
      workflow.indexOf("\n  npm-registry:"),
    )
    const registryJob = workflow.slice(
      workflow.indexOf("\n  npm-registry:"),
      workflow.indexOf("\n  npm-bootstrap:"),
    )
    const bootstrapJob = workflow.slice(
      workflow.indexOf("\n  npm-bootstrap:"),
      workflow.indexOf("\n  npm:"),
    )
    const publishJob = workflow.slice(
      workflow.indexOf("\n  npm:"),
      workflow.indexOf("\n  npm-verify:"),
    )
    const verifyJob = workflow.slice(
      workflow.indexOf("\n  npm-verify:"),
      workflow.indexOf("\n  manual-integration:"),
    )
    const releaseJob = workflow.slice(workflow.indexOf("\n  release:"))

    expect(workflow).toContain("tags:")
    expect(workflow).toContain("v*")
    expect(workflow).toContain("concurrency:")
    expect(workflow).toContain("needs: validate")
    expect(unsignedPickerJob).toContain("needs: [validate, manual-integration]")
    expect(linuxIntegrationJob).toContain("needs: picker-unsigned")
    expect(stageJob).toContain(
      "needs: [picker-unsigned, picker-linux-integration, picker-sign-macos, picker-sign-windows]",
    )
    expect(packageJob).toContain("needs: stage-release")
    expect(releaseJob).toContain("needs: [stage-release, npm-verify]")
    expect(releaseJob).not.toContain("actions/checkout@")
    expect(workflow).toContain("bun install --frozen-lockfile")
    expect(packageJob).toContain("bun run check:release-package")
    expect(workflow).toContain("runner: ubuntu-22.04")
    expect(workflow).toContain(
      "rustup toolchain install 1.97.1 --profile minimal --no-self-update",
    )
    expect(workflow.match(/id-token: write/g)).toHaveLength(3)
    expect(stageJob).toContain("id-token: write")
    expect(stageJob).toContain("attestations: write")
    expect(stageJob).toContain("artifact-metadata: write")
    expect(packageJob).not.toContain("id-token: write")
    expect(packageJob).toContain("Exercise exact npm tarball through OpenCode and native GUI")
    expect(packageJob).toContain("name: release-npm-package")
    expect(nativeSmokeJob).toContain("needs: npm-package")
    const tarballSmokeTargets = PICKER_TARGETS.filter(
      ({ platform, arch }) => platform !== "linux" || arch !== "x64",
    )
    expect(nativeSmokeJob.match(/^\s+- platform:/gm)).toHaveLength(
      tarballSmokeTargets.length,
    )
    for (const target of tarballSmokeTargets) {
      expect(nativeSmokeJob).toContain(
        workflowMatrixTarget(target.platform, target.arch),
      )
    }
    expect(nativeSmokeJob).toContain("runner: ubuntu-22.04-arm")
    expect(nativeSmokeJob).toContain("runner: macos-15")
    expect(nativeSmokeJob).toContain("runner: windows-2025")
    expect(nativeSmokeJob).toContain("runner: windows-11-arm")
    expect(nativeSmokeJob).toContain(
      "bun run scripts/smoke-installed-picker-tarball.ts",
    )
    const nativeSmokeTargets = PICKER_TARGETS.filter(
      ({ platform, arch }) => !(platform === "linux" && arch === "x64"),
    )
    expect(nativeSmokeJob.match(/^\s+- platform:/gm)).toHaveLength(
      nativeSmokeTargets.length,
    )
    for (const target of nativeSmokeTargets) {
      expect(nativeSmokeJob).toContain(
        workflowMatrixTarget(target.platform, target.arch),
      )
    }
    expect(registryJob).not.toContain("id-token: write")
    expect(registryJob).not.toContain("NPM_BOOTSTRAP_TOKEN")
    expect(registryJob).toContain("Check npm publication state")
    expect(bootstrapJob).toContain("environment: npm-bootstrap")
    expect(bootstrapJob).toContain("id-token: write")
    expect(bootstrapJob).toContain("NPM_BOOTSTRAP_TOKEN")
    expect(bootstrapJob).toContain("--provenance")
    expect(bootstrapJob).not.toContain("actions/checkout@")
    expect(publishJob).toContain("id-token: write")
    expect(publishJob).toContain("needs: [npm-package, npm-registry]")
    expect(publishJob).toContain("name: release-npm-package")
    expect(publishJob).toContain('npm publish "$PACKAGE_TARBALL"')
    expect(publishJob).not.toContain("NPM_BOOTSTRAP_TOKEN")
    expect(publishJob).not.toContain("actions/checkout@")
    expect(publishJob).not.toContain("oven-sh/setup-bun")
    expect(publishJob).not.toContain("bun install")
    expect(publishJob).not.toContain("bun run")
    expect(publishJob).not.toContain("sudo apt-get")
    expect(verifyJob).not.toContain("id-token: write")
    expect(verifyJob).toContain("actions/checkout@")
    expect(verifyJob).toContain("npm audit signatures")
    expect(workflow).toContain("NPM_BOOTSTRAP_TOKEN")
    expect(workflow).not.toContain("REPOSITORY_RULESET_AUDIT_TOKEN")
    expect(validateJob).not.toContain("check:public-repo")
    expect(validateJob).toContain("bun run check:release-ci")
    expect(validateJob).toContain("GITHUB_TOKEN: ${{ github.token }}")
    expect(validateJob).not.toContain("GITHUB_REPOSITORY_SETTINGS_TOKEN")
    expect(workflow).toMatch(/^permissions:\n  actions: read\n  contents: read$/m)
    expect(workflow).not.toContain("REPOSITORY_SETTINGS_READ_TOKEN")
    expect(workflow).toContain("name: release-picker-assets")
    expect(workflow).toContain("name: release-github-assets")
    expect(workflow).toContain("name: release-legal-assets")
    expect(workflow).toContain("name: release-notes")
    expect(workflow).toContain('canonical="$RUNNER_TEMP/release-picker-assets"')
    expect(workflow).toContain("overwrite: true")
    expect(workflow).toContain("scripts/verify-npm-provenance.ts")
    expect(workflow).toContain(
      'if [ -n "${NODE_AUTH_TOKEN:-}" ]',
    )
    expect(workflow).not.toMatch(/^\s+NODE_AUTH_TOKEN:/m)
    expect(workflow).not.toContain("secrets.NPM_TOKEN")
    expect(unsignedPickerJob).toContain("actions/checkout@")
    expect(unsignedPickerJob).toContain("bun run build:picker")
    expect(unsignedPickerJob).toContain("bash scripts/run-with-openbox.sh")
    expect(unsignedPickerJob).toContain(
      'WEBKIT_DISABLE_DMABUF_RENDERER: "1"',
    )
    expect(unsignedPickerJob).toContain(
      "cargo test --manifest-path picker/src-tauri/Cargo.toml --locked",
    )
    expect(unsignedPickerJob.match(/^\s+- platform:/gm)).toHaveLength(
      PICKER_TARGETS.length,
    )
    for (const target of PICKER_TARGETS) {
      expect(unsignedPickerJob).toContain(
        workflowMatrixTarget(target.platform, target.arch),
      )
    }
    expect(unsignedPickerJob).toContain(
      "name: picker-linux-${{ matrix.arch }}",
    )
    expect(unsignedPickerJob).toContain("name: picker-unsigned-macos-arm64")
    expect(unsignedPickerJob).toContain(
      "name: picker-unsigned-windows-${{ matrix.arch }}",
    )
    expect(unsignedPickerJob).not.toContain("opencode-ai@1.18.7")
    expect(unsignedPickerJob).not.toContain("test:package:native:opencode")
    expect(unsignedPickerJob).not.toContain("test:package:native:tui")
    expect(linuxIntegrationJob.match(/^\s+- arch:/gm)).toHaveLength(2)
    expect(linuxIntegrationJob).toContain("runner: ubuntu-22.04")
    expect(linuxIntegrationJob).toContain("runner: ubuntu-22.04-arm")
    expect(linuxIntegrationJob).toContain(
      "name: picker-linux-${{ matrix.arch }}",
    )
    expect(linuxIntegrationJob).toContain(
      "Install tested OpenCode runtime after artifact isolation",
    )
    expect(linuxIntegrationJob).toContain("opencode-ai@1.18.7")
    expect(linuxIntegrationJob).toContain("bun run test:package:native:opencode")
    expect(linuxIntegrationJob).toContain("bun run test:package:native:tui")
    expect(linuxIntegrationJob).toContain("bash scripts/run-with-openbox.sh")
    expect(linuxIntegrationJob).toContain(
      'WEBKIT_DISABLE_COMPOSITING_MODE: "1"',
    )
    expect(linuxIntegrationJob).not.toContain("actions/upload-artifact@")
    expect(unsignedPickerJob).not.toContain("${{ secrets.")
    expect(macosSigningJob).toContain("name: picker-unsigned-macos-arm64")
    expect(macosSigningJob).toContain("name: picker-macos-arm64")
    expect(macosSigningJob).toContain(
      "shell: /bin/bash --noprofile --norc -e -o pipefail {0}",
    )
    expect(macosSigningJob).toContain("/usr/bin/security")
    expect(macosSigningJob).toContain("/usr/bin/codesign")
    expect(macosSigningJob).toContain("/usr/bin/xcrun notarytool")
    expect(macosSigningJob).toContain('notarytool log "$notary_id"')
    expect(macosSigningJob).toContain(
      "/usr/sbin/spctl --assess --type exec",
    )
    expect(macosSigningJob).toContain("JSONSerialization.jsonObject")
    expect(macosSigningJob).toContain('root.keys.contains("issues")')
    expect(macosSigningJob).toContain("issues is NSNull")
    expect(macosSigningJob).toContain(
      "let issueList = issues as? [Any], issueList.isEmpty",
    )
    expect(macosSigningJob).toContain("notarization log contains issues or warnings")
    expect(macosSigningJob).toContain(
      'security delete-keychain "$keychain" || cleanup_status=$?',
    )
    expect(macosSigningJob).toContain(
      '"$RUNNER_TEMP/validate-notary-log.swift"',
    )
    expect(macosSigningJob).toContain(
      notaryValidator
        .trimEnd()
        .split("\n")
        .map((line) => line ? `          ${line}` : "")
        .join("\n"),
    )
    expect(macosSigningJob).toContain("secrets.APPLE_CERTIFICATE")
    expect(macosSigningJob).not.toContain("secrets.WINDOWS_CERTIFICATE")
    expect(macosSigningJob.match(/secrets\.APPLE_[A-Z_]+/g)).toHaveLength(7)
    const windowsTargets = PICKER_TARGETS.filter(
      ({ platform }) => platform === "windows",
    )
    expect(windowsSigningJob.match(/^\s+- arch:/gm)).toHaveLength(
      windowsTargets.length,
    )
    for (const target of windowsTargets) {
      const expectedMachine = target.machine
        .toString(16)
        .padStart(4, "0")
        .toUpperCase()
      expect(windowsSigningJob).toContain(
        `arch: ${target.arch}\n            expected_machine: "${expectedMachine}"`,
      )
    }
    expect(windowsSigningJob).toContain(
      "name: picker-unsigned-windows-${{ matrix.arch }}",
    )
    expect(windowsSigningJob).toContain(
      "name: picker-windows-${{ matrix.arch }}",
    )
    expect(windowsSigningJob).toContain(
      "shell: powershell -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass",
    )
    expect(windowsSigningJob).toContain('"WindowsPowerShell"')
    expect(windowsSigningJob).toContain('"powershell.exe"')
    expect(windowsSigningJob).toContain("$signtoolPath")
    expect(windowsSigningJob).toContain("secrets.WINDOWS_CERTIFICATE")
    expect(windowsSigningJob).not.toContain("secrets.APPLE_CERTIFICATE")
    expect(windowsSigningJob.match(/secrets\.WINDOWS_[A-Z_]+/g)).toHaveLength(2)
    for (const signingJob of [macosSigningJob, windowsSigningJob]) {
      const actions = [...signingJob.matchAll(/uses:\s+([^\s]+)/g)]
        .map((match) => match[1])
      expect(actions).toHaveLength(2)
      for (const action of actions) {
        expect(action).toMatch(/@[0-9a-f]{40}$/)
      }
      expect(signingJob).not.toContain("actions/checkout@")
      expect(signingJob).not.toContain("oven-sh/setup-bun")
      expect(signingJob).not.toContain("actions/setup-node")
      expect(signingJob).not.toMatch(/\b(?:bun|npm|npx|cargo|rustup|git)\b/)
      expect(signingJob).not.toMatch(/^\s+- run: .*bun/m)
      expect(signingJob).not.toMatch(/^\s+- run: .*npm/m)
      expect(signingJob).not.toMatch(/^\s+- run: .*cargo/m)
    }
    for (const target of PICKER_TARGETS) {
      expect(stageJob).toContain(
        `name: ${pickerArtifactName(target.assetName)}`,
      )
      expect(stageJob).toContain(target.assetName)
    }
    expect(stageJob).not.toContain("pattern: picker-*")
    expect(stageJob).toContain(
      "actions/attest@508db95dd578ae2727ebd6217d5ba78e4fbda05d",
    )
    expect(stageJob).toContain("if: steps.draft.outputs.exists != 'true'")
    expect(stageJob).toContain("gh attestation verify")
    expect(stageJob).toContain(
      '--signer-workflow "$GITHUB_REPOSITORY/.github/workflows/publish.yml"',
    )
    expect(stageJob).toContain('--signer-digest "$GITHUB_SHA"')
    expect(stageJob).toContain('--source-digest "$GITHUB_SHA"')
    expect(stageJob).toContain('--source-ref "$GITHUB_REF"')
    expect(stageJob).toContain("--deny-self-hosted-runners")
    expect(workflow.match(/git ls-remote/g)).toHaveLength(4)
    expect(stageJob).toContain('peeled_ref="${tag_ref}^{}"')
    expect(bootstrapJob).toContain('peeled_ref="${tag_ref}^{}"')
    expect(publishJob).toContain('peeled_ref="${tag_ref}^{}"')
    expect(releaseJob).toContain('peeled_ref="${tag_ref}^{}"')
    expect(stageJob.indexOf("git ls-remote")).toBeLessThan(
      stageJob.indexOf("gh release create"),
    )
    expect(releaseJob.indexOf("git ls-remote")).toBeLessThan(
      releaseJob.indexOf("gh release edit"),
    )
    expect(bootstrapJob.indexOf("git ls-remote")).toBeLessThan(
      bootstrapJob.indexOf('npm publish "$PACKAGE_TARBALL"'),
    )
    expect(publishJob.indexOf("git ls-remote")).toBeLessThan(
      publishJob.indexOf('npm publish "$PACKAGE_TARBALL"'),
    )
    expect(macosSigningJob.indexOf("Sign, notarize, and verify")).toBeLessThan(
      macosSigningJob.indexOf("Remove Apple signing credentials"),
    )
    expect(macosSigningJob.indexOf("Remove Apple signing credentials")).toBeLessThan(
      macosSigningJob.indexOf("Retain canonical signed macOS picker"),
    )
    expect(windowsSigningJob.indexOf("Sign and verify Windows picker")).toBeLessThan(
      windowsSigningJob.indexOf("Remove Windows signing credentials"),
    )
    expect(windowsSigningJob.indexOf("Remove Windows signing credentials")).toBeLessThan(
      windowsSigningJob.indexOf("Retain canonical signed Windows picker"),
    )
    expect(workflow).toContain("gh release create")
    expect(workflow).toContain("--draft")
    expect(workflow).toContain("--draft=false")
    expect(releaseJob).toContain('--notes-file "$release_notes"')
    expect(releaseJob).toContain('--title "$GITHUB_REF_NAME"')
    expect(workflow).toContain("scripts/extract-release-notes.ts")
    expect(stageJob).toContain("LICENSE")
    expect(stageJob).toContain("THIRD_PARTY_NOTICES.md")
    expect(workflow).toContain("SHA256SUMS")
    expect(workflow).not.toContain("--clobber")
    expect(workflow.indexOf("gh release create")).toBeLessThan(
      workflow.indexOf("npm publish"),
    )
    expect(workflow.indexOf("npm publish")).toBeLessThan(
      workflow.indexOf("gh release edit"),
    )
  })

  test("public docs cover users and release operators", async () => {
    const readme = await readText("README.md")
    const releasing = await readText("docs/releasing.md")

    for (const heading of ["## Install", "## Configuration", "## Setup", "## Privacy", "## Troubleshooting"]) {
      expect(readme).toContain(heading)
    }
    expect(releasing).toContain("mandatory local pre-tag gate")
    expect(releasing).toMatch(/contains no\s+repository-administration token/)
    expect(releasing).toContain("allowed action `npm publish`")
    expect(`${readme}\n${releasing}`).not.toContain("REPOSITORY_RULESET_AUDIT_TOKEN")
  })
})
