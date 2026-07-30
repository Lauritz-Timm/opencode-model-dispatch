import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"

describe("third-party notice release contract", () => {
  test("tracks every directly bundled JavaScript/source component at its exact version", async () => {
    const inventory = JSON.parse(
      await readFile(new URL("../third-party/components.json", import.meta.url), "utf8"),
    ) as {
      cargoAboutVersion: string
      components: Array<{ name: string; version: string; licenseFile: string }>
    }

    expect(inventory.cargoAboutVersion).toBe("0.9.1")
    expect(inventory.components.map(({ name, version }) => [name, version])).toEqual([
      ["@opencode-ai/sdk", "1.18.7"],
      ["OpenCode UI theme data and resolver code", "02981844b88aed33f06f1527da6c58d137975069"],
      ["svelte", "5.56.8"],
      ["@tauri-apps/api", "2.11.1"],
    ])

    for (const component of inventory.components) {
      const license = await readFile(new URL(`../${component.licenseFile}`, import.meta.url), "utf8")
      expect(license).toContain("Permission is hereby granted")
    }
  })

  test("ships the combined notice and keeps the Rust generator target-complete", async () => {
    const packageManifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as {
      files: string[]
    }
    expect(packageManifest.files).toContain("THIRD_PARTY_NOTICES.md")

    const config = await readFile(new URL("../third-party/about.toml", import.meta.url), "utf8")
    expect(config).toContain('"x86_64-unknown-linux-gnu"')
    expect(config).toContain('"aarch64-unknown-linux-gnu"')
    expect(config).toContain('"aarch64-apple-darwin"')
    expect(config).toContain('"x86_64-pc-windows-msvc"')
    expect(config).toContain('"aarch64-pc-windows-msvc"')
    expect(config).toContain("ignore-transitive-dependencies = false")

    const notices = await readFile(new URL("../THIRD_PARTY_NOTICES.md", import.meta.url), "utf8")
    for (const expected of ["@opencode-ai/sdk 1.18.7", "svelte 5.56.8", "@tauri-apps/api 2.11.1"]) {
      expect(notices).toContain(expected)
    }
    expect(notices).toContain("## Rust third-party licenses")

    const rustNotices = await readFile(
      new URL("../third-party/RUST_THIRD_PARTY_LICENSES.md", import.meta.url),
      "utf8",
    )
    for (const generatedNotices of [notices, rustNotices]) {
      expect(generatedNotices).not.toContain("\r")
      expect(generatedNotices).not.toMatch(/[ \t]+\n/)
      expect(generatedNotices).toEndWith("\n")
      expect(generatedNotices).not.toEndWith("\n\n")
    }
    for (const releaseGraphComponent of [
      "tauri 2.11.5",
      "wry 0.55.1",
      "webkit2gtk 2.0.2",
      "objc2-web-kit 0.3.2",
      "webview2-com 0.38.2",
    ]) {
      expect(rustNotices).toContain(releaseGraphComponent)
    }
  })
})
