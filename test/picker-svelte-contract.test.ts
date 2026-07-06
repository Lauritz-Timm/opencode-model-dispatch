import { describe, expect, test } from "bun:test"

const root = new URL("../", import.meta.url)

async function readText(path: string): Promise<string> {
  return await Bun.file(new URL(path, root)).text()
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readText(path)) as T
}

describe("picker Svelte and OpenCode token contract", () => {
  test("picker uses Svelte only and forbids React/TSX entry points", async () => {
    const pkg = await readJson<{ dependencies?: Record<string, string>; devDependencies?: Record<string, string> }>("picker/package.json")
    const tsconfig = await readText("picker/tsconfig.json")
    const vite = await readText("picker/vite.config.ts")
    const buildPicker = await readText("scripts/build-picker.ts")
    const main = await readText("picker/src/main.ts")

    expect(pkg.dependencies?.svelte).toBeDefined()
    expect(pkg.devDependencies?.["@sveltejs/vite-plugin-svelte"]).toBeDefined()
    expect(JSON.stringify(pkg)).not.toMatch(/react|@vitejs\/plugin-react/i)
    expect(tsconfig).toContain("src/**/*.svelte")
    expect(tsconfig).not.toContain("tsx")
    expect(vite).toContain("svelte()")
    expect(buildPicker).not.toContain("tsx")
    expect(main).toContain("./App.svelte")
    expect(main).toContain("mount(App")
    expect(main).not.toContain("new App")
  })

  test("picker theme exports OpenCode-named OKLCH tokens and CSS variables", async () => {
    const theme = await readText("picker/src/theme.ts")
    const app = await readText("picker/src/App.svelte")

    for (const token of [
      "opencode-bg",
      "opencode-surface",
      "opencode-text",
      "opencode-muted",
      "opencode-accent",
      "opencode-danger",
    ]) {
      expect(theme).toContain(token)
      expect(app).toContain(`--${token}`)
    }

    for (const role of ["backgroundPanel", "borderActive", "markdownCodeBlock", "syntaxPunctuation", "diffAddedLineNumberBg"]) {
      expect(await readText("picker/src/opencode-theme.ts")).toContain(role)
    }
    expect(theme).toContain("resolveOpenCodeTheme")
  })

  test("settings controls port OpenCode switch slots and avoid native number spinners", async () => {
    const toggleRow = await readText("picker/src/ToggleRow.svelte")
    const numberRow = await readText("picker/src/NumberRow.svelte")

    expect(toggleRow).toContain('data-component="switch"')
    expect(toggleRow).toContain('data-slot="switch-input"')
    expect(toggleRow).toContain('data-slot="switch-control"')
    expect(toggleRow).toContain('data-slot="switch-thumb"')
    expect(toggleRow).toContain("width: 24px")
    expect(toggleRow).toContain("height: 16px")
    expect(toggleRow).toContain("transform: translateX(8px)")
    expect(numberRow).toContain('type="text"')
    expect(numberRow).toContain('inputmode="numeric"')
    expect(numberRow).toContain("isValidNumberInput")
    expect(numberRow).not.toContain('type="number"')
  })
})
