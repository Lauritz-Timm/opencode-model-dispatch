import { describe, expect, test } from "bun:test"

const root = new URL("../", import.meta.url)

async function readText(path: string): Promise<string> {
  return await Bun.file(new URL(path, root)).text()
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readText(path)) as T
}

describe("picker preview fixtures", () => {
  test("root scripts make the Svelte picker easy to preview", async () => {
    const pkg = await readJson<{ scripts?: Record<string, string> }>("package.json")

    expect(pkg.scripts?.["dev:picker"]).toBe("bun run --cwd picker dev --host 127.0.0.1")
    expect(pkg.scripts?.["preview:picker"]).toBe("bun run dev:picker")
  })

  test("picker build uses Vite without the obsolete static build script", async () => {
    const pkg = await readJson<{ scripts?: Record<string, string> }>("picker/package.json")

    expect(pkg.scripts?.build).toBe("tsc -p tsconfig.json --noEmit && vite build")
    expect(await Bun.file(new URL("picker/scripts/build-static.ts", root)).exists()).toBe(false)
  })

  test("preview fixture includes realistic model-selection and setup data", async () => {
    const fixture = await readJson<{
      modelSelection: { tasks: unknown[]; models: unknown[] }
      setup: { settings: unknown; scope: string }
    }>("picker/src/preview-fixture.json")

    expect(fixture.modelSelection.tasks).toHaveLength(3)
    expect(fixture.modelSelection.models.length).toBeGreaterThanOrEqual(4)
    expect(fixture.setup.scope).toBe("project")
  })

  test("Svelte app loads fixture data only for preview mode", async () => {
    const app = await readText("picker/src/App.svelte")

    expect(app).toContain("previewFixture")
    expect(app).toContain('import("./preview-fixture.json")')
    expect(app).toContain("createTauriPickerRuntimeAdapter")
    expect(app).toContain("if (isDevPreview) return")
    expect(app).not.toContain('import previewFixture from "./preview-fixture.json"')
    expect(app).toContain("taskCount")
    expect(app).toContain("Apply to all")
    expect(app).toContain("Open model picker")
    expect(app).toContain("Settings")
    expect(app).toContain("Waiting for picker request")
  })

  test("dev launcher opens separate model picker and settings preview windows", async () => {
    const app = await readText("picker/src/App.svelte")
    const dts = await readText("picker/src/svelte.d.ts")
    const toggleRow = await readText("picker/src/ToggleRow.svelte")
    const numberRow = await readText("picker/src/NumberRow.svelte")

    expect(app).toContain("isDevPreview")
    expect(app).toContain("import.meta.env.DEV")
    expect(app).toContain("WebviewWindow")
    expect(app).toContain("openPreviewWindow")
    expect(app).toContain('url.searchParams.set("preview", "1")')
    expect(app).toContain("view")
    expect(app).toContain("settings")
    expect(app).not.toContain("preview-switcher")
    expect(app).toContain("settings-window")
    expect(app).toContain("Choose models")
    expect(app).toContain("Start tasks")
    expect(app).toContain("Save changes")
    expect(app).toContain("{#if !isPreviewWindow}")
    expect(app).toContain("app-chrome")
    expect(app).toContain("startWindowDrag")
    expect(app).toContain('data-component={isPreviewWindow ? "dialog-v2" : undefined}')
    expect(app).toContain("height: 100vh")
    expect(app).toContain("width: 100%")
    expect(app).toContain("scrollbar-width: none")
    expect(app).not.toContain("settings-sidebar")
    expect(app).not.toContain("Close preview")
    expect(app).not.toContain("JSON.stringify")
    expect(app).toContain("Preview Launcher")
    expect(app).toContain("Open model picker")
    expect(app).toContain("Open settings")
    expect(app).toContain("<ToggleRow")
    expect(app).toContain("<NumberRow")
    expect(toggleRow).toContain('data-slot="switch-input"')
    expect(toggleRow).toContain('data-slot="switch-control"')
    expect(toggleRow).toContain('data-slot="switch-thumb"')
    expect(numberRow).toContain('type="text"')
    expect(numberRow).toContain('inputmode="numeric"')
    expect(numberRow).toContain("isValidNumberInput")
    expect(numberRow).not.toContain('type="number"')
    expect(toggleRow).toContain('data-component="settings-v2-row"')
    expect(toggleRow).toContain('data-slot="settings-v2-row-control"')
    expect(numberRow).toContain('data-component="settings-v2-row"')
    expect(numberRow).toContain('data-slot="settings-v2-row-copy"')
    expect(app).toContain("--v2-background-bg-base")
    expect(app).toContain("--v2-border-border-muted")
    expect(dts).toContain("ImportMetaEnv")
  })

  test("settings preview keeps compact OpenCode sizing", async () => {
    const app = await readText("picker/src/App.svelte")
    const toggleRow = await readText("picker/src/ToggleRow.svelte")
    const numberRow = await readText("picker/src/NumberRow.svelte")

    expect(app).toContain("width: 680")
    expect(app).toContain("height: 500")
    expect(app).toContain("padding: 22px 18px 18px")
    expect(app).toContain("margin-bottom: 18px")
    expect(app).toContain("font-size: 13px")
    expect(app).toContain("padding-inline: 14px")
    expect(app).toContain(".settings-actions")
    expect(app).toContain("margin-top: 14px")
    expect(toggleRow).toContain("gap: 10px")
    expect(toggleRow).toContain("padding-block: 13px")
    expect(toggleRow).toContain("font-size: 12px")
    expect(toggleRow).toContain("min-width: 44px")
    expect(toggleRow).toContain("min-height: 32px")
    expect(numberRow).toContain("gap: 10px")
    expect(numberRow).toContain("padding-block: 13px")
    expect(numberRow).toContain("font-size: 12px")
    expect(numberRow).toContain("width: 136px")
    expect(numberRow).toContain("min-height: 32px")
  })

  test("native Tauri picker opens centered", async () => {
    const config = await readJson<{ app: { windows: Array<{ center?: boolean; decorations?: boolean; theme?: string }> } }>("picker/src-tauri/tauri.conf.json")
    const main = await readText("picker/src-tauri/src/main.rs")

    expect(config.app.windows[0]?.center).toBe(true)
    expect(config.app.windows[0]?.decorations).toBe(false)
    expect(config.app.windows[0]?.theme).toBe("Dark")
    expect(main).toContain("window.center()")
  })

  test("native Tauri dev starts the same local Vite preview host", async () => {
    const config = await readJson<{ build: { beforeDevCommand: string; devUrl: string } }>("picker/src-tauri/tauri.conf.json")

    expect(config.build.beforeDevCommand).toBe("bun run dev -- --host 127.0.0.1")
    expect(config.build.devUrl).toBe("http://127.0.0.1:5173")
  })

  test("Tauri capability permits dev preview windows", async () => {
    const capability = await readJson<{ windows: string[]; permissions: string[] }>("picker/src-tauri/capabilities/default.json")

    expect(capability.windows).toContain("main")
    expect(capability.windows).toContain("preview-*")
    expect(capability.permissions).toContain("core:webview:allow-create-webview-window")
    expect(capability.permissions).toContain("core:webview:allow-get-all-webviews")
    expect(capability.permissions).toContain("core:window:allow-set-focus")
    expect(capability.permissions).toContain("core:window:allow-close")
    expect(capability.permissions).toContain("core:window:allow-start-dragging")
    expect(capability.permissions).toContain("core:window:allow-minimize")
    expect(capability.permissions).toContain("core:window:allow-toggle-maximize")
  })
})
