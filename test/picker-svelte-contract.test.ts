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
    }

    for (const role of ["backgroundPanel", "borderActive", "markdownCodeBlock", "syntaxPunctuation", "diffAddedLineNumberBg"]) {
      expect(await readText("picker/src/opencode-theme.ts")).toContain(role)
    }
    expect(theme).toContain("resolveOpenCodeTheme")
    expect(app).toContain("cssVariables(tokens")
    expect(app).toContain("background: var(--v2-background-bg-base)")
    expect(app).toContain("color: var(--v2-text-text-base)")
    expect(app).not.toContain("var(--opencode-")
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

  test("model picker uses a custom OpenCode-style model dropdown instead of native selects", async () => {
    const app = await readText("picker/src/App.svelte")
    const modelSelect = await readText("picker/src/ModelSelect.svelte")
    const effortSelect = await readText("picker/src/EffortSelect.svelte")

    expect(app).toContain("ModelSelect")
    expect(app).toContain("EffortSelect")
    expect(app).toContain("groups={modelGroupsForRow(row.id)}")
    expect(modelSelect).not.toContain("<select")
    expect(modelSelect).toContain('role="listbox"')
    expect(modelSelect).toContain('aria-expanded={open}')
    expect(modelSelect).toContain('placeholder="Search models"')
    expect(modelSelect).toContain("provider-heading")
    expect(modelSelect).toContain("provider-id")
    expect(modelSelect).toContain("model-identity")
    expect(modelSelect).toContain("formatModelAccessibleLabel")
    expect(modelSelect).toContain("escapeModelIdentifier")
    expect(modelSelect).toContain('dir="ltr"')
    expect(modelSelect).toContain("unicode-bidi: isolate")
    expect(modelSelect).toMatch(
      /\.model-option-copy \.model-identity\s*\{[^}]*overflow:\s*visible[^}]*white-space:\s*normal[^}]*overflow-wrap:\s*anywhere/s,
    )
    expect(modelSelect).toContain("selected-check")
    expect(modelSelect).toMatch(/\.model-select\s*\{[^}]*width:\s*100%/s)
    expect(modelSelect).toMatch(/\.model-popover\s*\{[^}]*width:\s*100%[^}]*box-sizing:\s*border-box/s)
    expect(modelSelect).toMatch(/\.selector-button\s*\{[^}]*height:\s*30px[^}]*box-sizing:\s*border-box/s)
    expect(modelSelect).not.toContain("width: 220px")
    expect(app).toMatch(/\.model-row\s*\{[^}]*flex-wrap:\s*nowrap/s)
    expect(app).toMatch(/\.model-controls\s*\{[^}]*display:\s*flex/s)
    expect(app).toMatch(/\.model-controls\s*\{[^}]*flex-wrap:\s*nowrap/s)
    expect(app).toMatch(/\.model-controls\s*\{[^}]*width:\s*min\(420px, 66%\)[^}]*flex:\s*0 1 420px/s)
    expect(app).toMatch(/\.model-controls :global\(\.model-select\)\s*\{[^}]*flex:\s*1 1 auto/s)
    expect(app).toMatch(/\.model-controls :global\(\.effort-select\)\s*\{[^}]*flex:\s*0 0 152px/s)
    expect(app).toContain("@media (max-width: 540px)")
    expect(app).toMatch(/@media \(max-width: 540px\)\s*\{[\s\S]*?\.model-row\s*\{[^}]*flex-wrap:\s*wrap[\s\S]*?\.model-controls\s*\{[^}]*flex:\s*1 0 100%/)
    expect(app).not.toMatch(/\.model-controls :global\(\.effort-select\)\s*\{[^}]*flex-basis:\s*100%/)
    expect(modelSelect).toContain('event.key === "ArrowDown"')
    expect(modelSelect).toContain("const listboxID =")
    expect(modelSelect).toContain("bind:this={triggerButton}")
    expect(modelSelect).toContain("triggerButton?.focus()")
    expect(modelSelect).toContain("closeDropdown(true)")
    expect(modelSelect).toContain('role="combobox"')
    expect(modelSelect).toContain("id={listboxID}")
    expect(modelSelect).toContain('id={`${listboxID}-option-${optionIndex}`}')
    expect(modelSelect).toMatch(/<input[\s\S]*?aria-activedescendant=/)
    const popoverOpening = modelSelect.slice(
      modelSelect.indexOf('<div class="model-popover"'),
      modelSelect.indexOf('<div class="search-row">'),
    )
    expect(popoverOpening).not.toContain("aria-activedescendant")
    expect(modelSelect).not.toContain("popover-glyphs")
    expect(effortSelect).toContain("<select")
    expect(effortSelect.indexOf('<option value="">Auto</option>')).toBeLessThan(effortSelect.indexOf("{#each options as variant}"))
    expect(effortSelect).toContain("disabled={options.length === 0}")
    expect(effortSelect).toContain("formatEffortVariantLabel(variant)")
    expect(effortSelect).toContain("-webkit-appearance: none")
    expect(effortSelect).toContain("appearance: none")
    expect(effortSelect).toContain("color-scheme: inherit")
    expect(effortSelect).toMatch(/\.select-shell\s*\{[^}]*height:\s*30px[^}]*box-sizing:\s*border-box/s)
    expect(effortSelect).toContain("background-color: var(--v2-background-bg-base)")
    expect(effortSelect).toContain("-webkit-text-fill-color: var(--v2-text-text-base)")
    expect(effortSelect).toContain("select-chevron")
    expect(effortSelect).toContain(".select-shell:focus-within")
    expect(effortSelect).toContain("var(--v2-border-border-focus)")
    expect(effortSelect).toContain(".select-shell.disabled")
    expect(app).toContain("color-scheme: dark")
    expect(app).toContain('shell[data-color-scheme="light"]')
    expect(app).toContain("theme: themeName")
    expect(`${app}\n${modelSelect}\n${effortSelect}`).not.toContain("--v2-border-border-active")
    expect(app).toContain("setAllVariants")
    expect(app).toContain("setRowVariant")
    expect(app).toContain("applyModelSelectionAction")
    expect(app).toContain("modelRefForValue")
    expect(app).toContain("variantsForSelectionTarget")
    expect(app).toContain("modelState.selections[row.id]")
    expect(app).toContain("modelState.applyToAllModel?.variant")
    expect(app).not.toContain("selectedVariants")
    expect(app).not.toContain("normalizeVariant")
    expect(app).not.toContain("currentModelSelectionState")
    expect(app).toContain('ariaLabel="Apply effort to all tasks"')
  })

  test("native close is an explicit cancel and parent stdin EOF exits the picker", async () => {
    const app = await readText("picker/src/App.svelte")
    const main = await readText("picker/src-tauri/src/main.rs")

    expect(app).toContain("onCloseRequested")
    expect(app).toContain("await cancelPicker()")
    expect(app).toContain("event.preventDefault()")
    expect(main).toContain("app_handle.exit(0)")
  })

  test("native startup is acknowledged only after the request reaches the rendered app", async () => {
    const app = await readText("picker/src/App.svelte")
    const runtime = await readText("picker/src/runtime-rpc.ts")

    expect(app).toMatch(
      /runtimeAdapter\.start\(async \(request\) => \{\s+runtimeRequest = request\s+await tick\(\)\s+await revealPickerWindow\(\)/,
    )
    expect(app).toMatch(
      /async function revealPickerWindow\(\) \{\s+const pickerWindow = getCurrentWindow\(\)\s+await pickerWindow\.show\(\)\s+void pickerWindow\.setFocus\(\)\.catch\(\(\) => undefined\)/,
    )
    expect(runtime).toContain('method: "started"')
    expect(runtime.indexOf("Promise.resolve(onStart(request))")).toBeLessThan(
      runtime.indexOf('method: "started"'),
    )
  })

  test("runtime decisions fail generically, remain retryable, and lock duplicate actions while sending", async () => {
    const app = await readText("picker/src/App.svelte")

    expect(app).toContain("const decisionFailureMessage")
    expect(app).toContain('role="alert"')
    expect(app.match(/decisionSent = true/g)).toHaveLength(1)
    expect(app).toMatch(/try \{\s+await send\(\)\s+decisionSent = true/)
    expect(app).toMatch(/catch \{\s+decisionError = decisionFailureMessage\s+\} finally \{\s+sendingDecision = false/)
    expect(app).toContain("disabled={sendingDecision || decisionSent")
    expect(app).toContain("aria-busy={sendingDecision}")
    expect(app).not.toMatch(/catch \([^)]*(error|reason|cause)/)
  })

  test("system color scheme is resolved locally and kept in sync with OS changes", async () => {
    const app = await readText("picker/src/App.svelte")

    expect(app).toContain('typeof window !== "undefined"')
    expect(app).toContain('window.matchMedia(systemThemeMedia)')
    expect(app).toContain('addEventListener("change", handleSystemThemeChange)')
    expect(app).toContain('removeEventListener("change", handleSystemThemeChange)')
    expect(app).toContain("resolveOpenCodeThemeCss(themeHint, systemPrefersLight)")
  })
})
