interface FrameFixture {
  name: "normal" | "narrow" | "settings"
  width: number
  height: number
  frame: HTMLIFrameElement
}

interface RenderedUiResult {
  ok: boolean
  assertions: number
  measurements?: {
    normalModelWidth: number
    normalPopoverWidth: number
    narrowControlsWidth: number
    narrowModelWidth: number
  }
  error?: string
}

const callback = localCallbackUrl(
  new URLSearchParams(window.location.search).get("callback"),
)
let assertionCount = 0

void run()
  .then((result) => report({ ok: true, assertions: assertionCount, ...result }))
  .catch((error: unknown) =>
    report({
      ok: false,
      assertions: assertionCount,
      error: error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error),
    }),
  )

async function run(): Promise<Pick<RenderedUiResult, "measurements">> {
  await reportProgress("probe-loaded")
  const fixtures = [
    createFrame("normal", 680, 500, "models"),
    createFrame("narrow", 480, 700, "models"),
    createFrame("settings", 800, 560, "settings"),
  ] as const

  await Promise.all(fixtures.map(waitForFrame))
  await reportProgress("frames-loaded")
  await Promise.all([
    ...fixtures.slice(0, 2).map(({ frame }) =>
      waitFor(() => frame.contentDocument?.querySelectorAll(".model-row").length === 4),
    ),
    waitFor(() => Boolean(
      fixtures[2].frame.contentDocument?.querySelector(
        '.scope-control .compact-trigger[aria-label^="Configuration scope:"]',
      ),
    )),
  ])
  await reportProgress("picker-views-rendered")

  const normal = inspectFrame(fixtures[0])
  const narrow = inspectFrame(fixtures[1])
  const settings = inspectFrame(fixtures[2])
  await reportProgress("frames-inspected")
  await assertTheme(normal)
  await reportProgress("theme-asserted")
  const normalMeasurements = await assertNormalLayoutAndKeyboard(normal)
  await reportProgress("normal-layout-and-keyboard-asserted")
  const narrowMeasurements = assertNarrowLayout(narrow)
  await reportProgress("narrow-layout-asserted")
  await assertSettingsSelect(settings)
  await reportProgress("settings-select-asserted")

  return {
    measurements: {
      ...normalMeasurements,
      ...narrowMeasurements,
    },
  }
}

function createFrame(
  name: FrameFixture["name"],
  width: number,
  height: number,
  view: "models" | "settings",
): FrameFixture {
  const frame = document.createElement("iframe")
  frame.dataset.fixture = name
  frame.title = `${name} rendered picker fixture`
  frame.width = String(width)
  frame.height = String(height)
  frame.style.cssText = `display:block;width:${width}px;height:${height}px;border:0`
  frame.src =
    `/?preview=1&view=${view}&themeID=nightowl&colorScheme=dark`
  required(document, "#rendered-test-root").append(frame)
  return { name, width, height, frame }
}

async function waitForFrame(fixture: FrameFixture): Promise<void> {
  if (fixture.frame.contentDocument?.readyState === "complete") return
  await new Promise<void>((resolve, reject) => {
    fixture.frame.addEventListener("load", () => resolve(), { once: true })
    fixture.frame.addEventListener(
      "error",
      () => reject(new Error(`${fixture.name} picker frame failed to load`)),
      { once: true },
    )
  })
}

function inspectFrame(fixture: FrameFixture) {
  const document = fixture.frame.contentDocument
  const window = fixture.frame.contentWindow
  check(document && window, `${fixture.name}: same-origin picker frame is available`)
  check(
    window.innerWidth === fixture.width,
    `${fixture.name}: viewport is ${fixture.width}px wide (received ${window.innerWidth}px)`,
  )
  return { ...fixture, document, window }
}

async function assertTheme(
  fixture: ReturnType<typeof inspectFrame>,
): Promise<void> {
  const shell = required<HTMLElement>(fixture.document, ".shell")
  const picker = required<HTMLElement>(fixture.document, ".picker-window")
  const panel = required<HTMLElement>(fixture.document, ".preview-panel")
  const rowLabel = required<HTMLElement>(
    fixture.document,
    ".model-row strong",
  )
  await reportProgress("theme-elements-found")
  const shellStyle = fixture.window.getComputedStyle(shell)
  await reportProgress("shell-style-computed")
  const expectedTokens: Record<string, string> = {
    "v2-background-bg-base": "var(--v2-grey-1000)",
    "v2-background-bg-layer-01": "var(--v2-grey-800)",
    "v2-text-text-base": "#fbfcfd",
    "v2-text-text-muted": "#b4bac7",
    "v2-border-border-focus": "var(--v2-blue-500)",
  }

  check(shell.dataset.theme === "nightowl", "active OpenCode theme reaches the rendered shell")
  check(shell.dataset.colorScheme === "dark", "active color scheme reaches the rendered shell")
  for (const token of [
    "v2-background-bg-base",
    "v2-background-bg-layer-01",
    "v2-text-text-base",
    "v2-text-text-muted",
    "v2-border-border-focus",
  ]) {
    const actual = normalizeCssValue(
      shell.style.getPropertyValue(`--${token}`),
    )
    const expectedValue = normalizeCssValue(expectedTokens[token] ?? "")
    check(expectedValue.length > 0, `nightowl defines --${token}`)
    check(
      actual === expectedValue,
      `rendered --${token} matches nightowl (${actual} versus ${expectedValue})`,
    )
  }
  await reportProgress("theme-tokens-asserted")

  const tokenProbe = fixture.document.createElement("span")
  tokenProbe.style.cssText = [
    "position:fixed",
    "left:-10000px",
    "background:var(--v2-background-bg-base)",
    "color:var(--v2-text-text-base)",
    "border:1px solid var(--v2-border-border-focus)",
  ].join(";")
  shell.append(tokenProbe)
  const probeStyle = fixture.window.getComputedStyle(tokenProbe)
  await reportProgress("token-probe-style-computed")
  const pickerStyle = fixture.window.getComputedStyle(picker)
  const panelStyle = fixture.window.getComputedStyle(panel)
  const rowLabelStyle = fixture.window.getComputedStyle(rowLabel)
  await reportProgress("component-styles-computed")

  check(
    pickerStyle.backgroundColor === probeStyle.backgroundColor,
    "picker background computes from --v2-background-bg-base",
  )
  tokenProbe.style.background = "var(--v2-background-bg-layer-01)"
  check(
    panelStyle.backgroundColor ===
      fixture.window.getComputedStyle(tokenProbe).backgroundColor,
    "panel background computes from --v2-background-bg-layer-01",
  )
  check(
    rowLabelStyle.color === probeStyle.color,
    "model labels compute from --v2-text-text-base",
  )
  check(
    probeStyle.backgroundColor !== probeStyle.color,
    "computed foreground and background remain visually distinct",
  )
  check(
    probeStyle.borderTopColor !== "rgba(0, 0, 0, 0)" &&
      probeStyle.borderTopColor !== "transparent",
    "focus token resolves to a visible computed color",
  )
  tokenProbe.remove()
}

async function assertNormalLayoutAndKeyboard(
  fixture: ReturnType<typeof inspectFrame>,
): Promise<{
  normalModelWidth: number
  normalPopoverWidth: number
}> {
  const row = required<HTMLElement>(fixture.document, ".apply-row")
  const copy = required<HTMLElement>(row, ".model-row-copy")
  const controls = required<HTMLElement>(row, ".model-controls")
  const model = required<HTMLElement>(controls, ".model-select")
  const trigger = required<HTMLButtonElement>(model, ".selector-button")
  const effort = required<HTMLElement>(controls, ".effort-select")
  const controlsStyle = fixture.window.getComputedStyle(controls)
  const modelRect = model.getBoundingClientRect()
  const triggerRect = trigger.getBoundingClientRect()
  const effortRect = effort.getBoundingClientRect()
  const controlsRect = controls.getBoundingClientRect()
  const copyRect = copy.getBoundingClientRect()
  const gap = Number.parseFloat(controlsStyle.columnGap)

  check(
    fixture.window.getComputedStyle(row).flexWrap === "nowrap",
    "normal row does not wrap",
  )
  check(controlsStyle.flexWrap === "nowrap", "normal controls do not wrap")
  check(
    close(modelRect.width + effortRect.width + gap, controlsRect.width, 1.5),
    "apply-to-all model fills all control width not reserved for effort",
  )
  check(
    close(triggerRect.width, modelRect.width, 1),
    "apply-to-all model trigger spans its full model column",
  )
  check(
    close(modelRect.top, effortRect.top, 1) &&
      close(modelRect.bottom, effortRect.bottom, 1),
    "model and effort controls share one line at normal width",
  )
  check(
    close(
      (copyRect.top + copyRect.bottom) / 2,
      (controlsRect.top + controlsRect.bottom) / 2,
      2,
    ),
    "row copy and controls are vertically aligned at normal width",
  )
  check(
    controlsRect.right <= row.getBoundingClientRect().right - 7,
    "normal controls remain inside row padding",
  )

  trigger.focus()
  trigger.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "ArrowDown",
      bubbles: true,
      cancelable: true,
    }),
  )
  await waitFor(() => Boolean(model.querySelector(".model-popover")))
  const search = required<HTMLInputElement>(model, 'input[aria-label="Search models"]')
  const popover = required<HTMLElement>(model, ".model-popover")
  const popoverRect = popover.getBoundingClientRect()
  check(
    close(popoverRect.width, modelRect.width, 1),
    "apply-to-all model popover spans the full trigger width",
  )
  check(
    fixture.document.activeElement === search,
    "ArrowDown opens the model picker and focuses search",
  )
  check(
    popover.querySelectorAll(".search-row button, .search-row [role=button]").length === 0,
    "model search row renders no add or settings controls",
  )
  const forbiddenControls = Array.from(
    popover.querySelectorAll<HTMLElement>("button, [role=button]"),
  ).filter((element) => {
    const label = `${element.getAttribute("aria-label") ?? ""} ${element.textContent ?? ""}`.trim()
    return /(^|\s)(\+|⚙|gear)(\s|$)|\b(add|create|manage|settings)\b/i.test(label)
  })
  check(
    forbiddenControls.length === 0,
    "model popover contains no plus or gear action",
  )
  const initialOptions = Array.from(
    popover.querySelectorAll<HTMLElement>('[role="option"]'),
  )
  check(
    initialOptions.map((option) =>
      option.querySelector(".model-option-label")?.textContent
    ).join("|") === "Claude 3.5 Sonnet|GPT-4o",
    "apply-to-all renders exactly its explicit common-model catalog",
  )

  search.value = "gpt"
  search.dispatchEvent(new InputEvent("input", { bubbles: true }))
  await waitFor(() => popover.querySelectorAll('[role="option"]').length === 1)
  const options = popover.querySelectorAll<HTMLElement>('[role="option"]')
  check(options[0]?.textContent?.includes("GPT-4o"), "search filters to GPT-4o")
  check(
    options[0]?.textContent?.includes("openai · gpt-4o"),
    "model option visibly identifies its stable provider and model IDs",
  )
  check(
    options[0]?.getAttribute("aria-label") ===
      "GPT-4o, provider ID openai, model ID gpt-4o",
    "model option exposes the same stable identity accessibly",
  )
  const providerHeading =
    required<HTMLElement>(popover, ".provider-heading").textContent ?? ""
  check(
    providerHeading.includes("OpenAI") && providerHeading.includes("openai"),
    "search preserves the matching provider group and stable provider ID",
  )
  search.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "ArrowDown",
      bubbles: true,
      cancelable: true,
    }),
  )
  search.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    }),
  )
  await waitFor(() => !model.querySelector(".model-popover"))
  check(
    trigger.textContent?.includes("GPT-4o"),
    "Enter commits the keyboard-selected model",
  )
  check(
    trigger.textContent?.includes("openai · gpt-4o"),
    "selected trigger keeps stable provider and model IDs visible",
  )
  check(
    trigger.getAttribute("aria-label")?.includes(
      "provider ID openai, model ID gpt-4o",
    ),
    "selected trigger announces stable provider and model IDs",
  )
  check(
    fixture.document.activeElement === trigger,
    "model selection restores focus to its trigger",
  )

  const effortTrigger = required<HTMLButtonElement>(
    controls,
    ".effort-select .compact-trigger",
  )
  check(!effortTrigger.disabled, "selected model enables its effort dropdown")
  check(
    effortTrigger.textContent?.includes("Auto"),
    "effort remains Auto by default",
  )
  check(
    effortTrigger.getAttribute("aria-haspopup") === "listbox"
      && effortTrigger.getAttribute("aria-expanded") === "false",
    "effort trigger exposes its closed listbox state",
  )

  const pickerWindow = required<HTMLElement>(
    fixture.document,
    ".picker-window",
  )
  const pickerWindowStyle = pickerWindow.getAttribute("style")
  pickerWindow.style.height = "250px"
  pickerWindow.style.flex = "0 0 250px"
  pickerWindow.style.boxSizing = "border-box"
  await waitFor(() => pickerWindow.getBoundingClientRect().height <= 251)

  effortTrigger.focus()
  effortTrigger.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "ArrowDown",
      bubbles: true,
      cancelable: true,
    }),
  )
  await waitFor(() => Boolean(effort.querySelector(".compact-popover")))
  const effortPopover = required<HTMLElement>(effort, ".compact-popover")
  const effortOptions = Array.from(
    effortPopover.querySelectorAll<HTMLElement>('[role="option"]'),
  )
  check(
    effortTrigger.getAttribute("aria-expanded") === "true"
      && effortTrigger.getAttribute("aria-controls") === effortPopover.id,
    "effort trigger links to its open listbox",
  )
  check(
    effortOptions.length === 17
      && optionLabel(effortOptions[0]) === "Auto"
      && optionLabel(effortOptions.at(-1)) === "Adaptive",
    "effort dropdown renders Auto plus the maximum 16 provider-advertised variants",
  )
  check(
    effortOptions[0]?.getAttribute("aria-selected") === "true"
      && fixture.document.activeElement === effortOptions[0],
    "effort listbox marks and focuses its current option",
  )
  const effortPopoverRect = effortPopover.getBoundingClientRect()
  const pickerWindowRect = pickerWindow.getBoundingClientRect()
  check(
    effortPopover.scrollHeight > effortPopover.clientHeight
      && effortPopoverRect.top >= pickerWindowRect.top + 3
      && effortPopoverRect.bottom <= pickerWindowRect.bottom - 3,
    "maximum-size effort dropdown is clipping-ancestor-bounded and vertically scrollable",
  )

  const effortThemeProbe = fixture.document.createElement("span")
  effortThemeProbe.style.cssText = [
    "position:fixed",
    "left:-10000px",
    "background:var(--v2-background-bg-layer-01)",
    "color:var(--v2-text-text-base)",
  ].join(";")
  required<HTMLElement>(fixture.document, ".shell").append(effortThemeProbe)
  const effortProbeStyle = fixture.window.getComputedStyle(effortThemeProbe)
  const effortPopoverStyle = fixture.window.getComputedStyle(effortPopover)
  const firstEffortOptionStyle = fixture.window.getComputedStyle(effortOptions[0]!)
  check(
    effortPopoverStyle.backgroundColor === effortProbeStyle.backgroundColor,
    "effort popup background computes from the active OpenCode theme",
  )
  check(
    firstEffortOptionStyle.color === effortProbeStyle.color,
    "effort option text computes from the active OpenCode theme",
  )
  effortThemeProbe.style.background = "var(--v2-background-bg-layer-03)"
  check(
    firstEffortOptionStyle.backgroundColor
      === fixture.window.getComputedStyle(effortThemeProbe).backgroundColor,
    "selected effort option background computes from the active OpenCode theme",
  )
  effortThemeProbe.remove()

  effortOptions[0]?.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "x",
      bubbles: true,
      cancelable: true,
    }),
  )
  const xhighOption = effortOptions.find((option) => optionLabel(option) === "Xhigh")
  await waitFor(() => fixture.document.activeElement === xhighOption)
  check(
    fixture.document.activeElement === xhighOption,
    "printable-character typeahead focuses the matching effort",
  )

  xhighOption?.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "End",
      bubbles: true,
      cancelable: true,
    }),
  )
  await waitFor(() => fixture.document.activeElement === effortOptions.at(-1))
  const finalEffortRect = effortOptions.at(-1)?.getBoundingClientRect()
  const scrolledPopoverRect = effortPopover.getBoundingClientRect()
  check(
    effortPopover.scrollTop > 0
      && Boolean(finalEffortRect)
      && finalEffortRect!.top >= scrolledPopoverRect.top
      && finalEffortRect!.bottom <= scrolledPopoverRect.bottom,
    "End scrolls the maximum-size effort list to keep its active option visible",
  )
  effortOptions.at(-1)?.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    }),
  )
  await waitFor(() => !effort.querySelector(".compact-popover"))
  check(
    effortTrigger.textContent?.includes("Adaptive"),
    "keyboard selection commits the provider-advertised effort",
  )
  check(
    fixture.document.activeElement === effortTrigger,
    "effort selection restores focus to its trigger",
  )

  effortTrigger.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "ArrowDown",
      bubbles: true,
      cancelable: true,
    }),
  )
  await waitFor(() => Boolean(effort.querySelector(".compact-popover")))
  const reopenedEffortOption = required<HTMLElement>(
    effort,
    '.compact-option[aria-selected="true"]',
  )
  reopenedEffortOption.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }),
  )
  await waitFor(() => !effort.querySelector(".compact-popover"))
  check(
    fixture.document.activeElement === effortTrigger,
    "Escape closes the effort listbox and restores trigger focus",
  )
  if (pickerWindowStyle === null) pickerWindow.removeAttribute("style")
  else pickerWindow.setAttribute("style", pickerWindowStyle)

  trigger.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "ArrowDown",
      bubbles: true,
      cancelable: true,
    }),
  )
  await waitFor(() => Boolean(model.querySelector(".model-popover")))
  const reopenedSearch = required<HTMLInputElement>(
    model,
    'input[aria-label="Search models"]',
  )
  reopenedSearch.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }),
  )
  await waitFor(() => !model.querySelector(".model-popover"))
  check(
    fixture.document.activeElement === trigger,
    "Escape closes the popover and restores trigger focus",
  )

  const taskRow = required<HTMLElement>(
    fixture.document,
    ".model-row:not(.apply-row)",
  )
  const taskModel = required<HTMLElement>(taskRow, ".model-select")
  const taskTrigger = required<HTMLButtonElement>(
    taskModel,
    ".selector-button",
  )
  taskTrigger.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "ArrowDown",
      bubbles: true,
      cancelable: true,
    }),
  )
  await waitFor(() => Boolean(taskModel.querySelector(".model-popover")))
  const taskSearch = required<HTMLInputElement>(
    taskModel,
    'input[aria-label="Search models"]',
  )
  check(
    taskModel.querySelectorAll('[role="option"]').length === 4,
    "task row receives its complete model catalog",
  )
  taskSearch.value = "gemini"
  taskSearch.dispatchEvent(new InputEvent("input", { bubbles: true }))
  await waitFor(
    () => taskModel.querySelectorAll('[role="option"]').length === 1,
  )
  taskSearch.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    }),
  )
  await waitFor(() => !taskModel.querySelector(".model-popover"))
  check(
    taskTrigger.textContent?.includes("Gemini 1.5 Pro"),
    "task row can commit a model from its own catalog",
  )

  return {
    normalModelWidth: rounded(modelRect.width),
    normalPopoverWidth: rounded(popoverRect.width),
  }
}

async function assertSettingsSelect(
  fixture: ReturnType<typeof inspectFrame>,
): Promise<void> {
  const scope = required<HTMLElement>(fixture.document, ".scope-control")
  const trigger = required<HTMLButtonElement>(scope, ".compact-trigger")
  check(
    fixture.document.querySelectorAll("select").length === 0,
    "settings renders no native select controls",
  )
  check(
    trigger.textContent?.includes("This project"),
    "configuration scope starts from the project fixture value",
  )
  check(
    trigger.getAttribute("aria-haspopup") === "listbox"
      && trigger.getAttribute("aria-expanded") === "false",
    "configuration scope trigger exposes its closed listbox state",
  )

  trigger.focus()
  trigger.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "ArrowDown",
      bubbles: true,
      cancelable: true,
    }),
  )
  await waitFor(() => Boolean(scope.querySelector(".compact-popover")))
  const popover = required<HTMLElement>(scope, ".compact-popover")
  const options = Array.from(
    popover.querySelectorAll<HTMLElement>('[role="option"]'),
  )
  check(
    trigger.getAttribute("aria-expanded") === "true"
      && trigger.getAttribute("aria-controls") === popover.id
      && fixture.document.querySelectorAll(`#${popover.id}`).length === 1,
    "configuration scope trigger links to one unique open listbox",
  )
  check(
    options.map(optionLabel).join("|") === "Global|This project",
    "configuration scope renders its two supported values",
  )
  check(
    options[1]?.getAttribute("aria-selected") === "true"
      && fixture.document.activeElement === options[1],
    "configuration scope marks and focuses its current option",
  )

  const themeProbe = fixture.document.createElement("span")
  themeProbe.style.cssText = [
    "position:fixed",
    "left:-10000px",
    "background:var(--v2-background-bg-layer-01)",
    "color:var(--v2-text-text-base)",
  ].join(";")
  required<HTMLElement>(fixture.document, ".shell").append(themeProbe)
  const probeStyle = fixture.window.getComputedStyle(themeProbe)
  const popoverStyle = fixture.window.getComputedStyle(popover)
  const selectedStyle = fixture.window.getComputedStyle(options[1]!)
  check(
    popoverStyle.backgroundColor === probeStyle.backgroundColor,
    "configuration scope popup background computes from the active OpenCode theme",
  )
  check(
    selectedStyle.color === probeStyle.color,
    "configuration scope option text computes from the active OpenCode theme",
  )
  themeProbe.style.background = "var(--v2-background-bg-layer-03)"
  check(
    selectedStyle.backgroundColor
      === fixture.window.getComputedStyle(themeProbe).backgroundColor,
    "configuration scope selected state computes from the active OpenCode theme",
  )
  themeProbe.remove()

  options[1]?.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Home",
      bubbles: true,
      cancelable: true,
    }),
  )
  await waitFor(() => fixture.document.activeElement === options[0])
  options[0]?.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    }),
  )
  await waitFor(() => !scope.querySelector(".compact-popover"))
  check(
    trigger.textContent?.includes("Global")
      && fixture.document.activeElement === trigger,
    "Home and Enter select Global and restore trigger focus",
  )

  trigger.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "t",
      bubbles: true,
      cancelable: true,
    }),
  )
  await waitFor(() => Boolean(scope.querySelector(".compact-popover")))
  const typeaheadOption = required<HTMLElement>(
    scope,
    '.compact-option[data-compact-option-index="1"]',
  )
  await waitFor(() => fixture.document.activeElement === typeaheadOption)
  typeaheadOption.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    }),
  )
  await waitFor(() => !scope.querySelector(".compact-popover"))
  check(
    trigger.textContent?.includes("This project"),
    "printable-character typeahead opens and selects This project",
  )

  trigger.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: " ",
      bubbles: true,
      cancelable: true,
    }),
  )
  await waitFor(() => Boolean(scope.querySelector(".compact-popover")))
  const selectedOption = required<HTMLElement>(
    scope,
    '.compact-option[aria-selected="true"]',
  )
  selectedOption.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }),
  )
  await waitFor(() => !scope.querySelector(".compact-popover"))
  check(
    fixture.document.activeElement === trigger,
    "Space opens and Escape closes configuration scope with focus restoration",
  )
}

function assertNarrowLayout(
  fixture: ReturnType<typeof inspectFrame>,
): {
  narrowControlsWidth: number
  narrowModelWidth: number
} {
  const row = required<HTMLElement>(fixture.document, ".apply-row")
  const copy = required<HTMLElement>(row, ".model-row-copy")
  const controls = required<HTMLElement>(row, ".model-controls")
  const model = required<HTMLElement>(controls, ".model-select")
  const effort = required<HTMLElement>(controls, ".effort-select")
  const rowRect = row.getBoundingClientRect()
  const copyRect = copy.getBoundingClientRect()
  const controlsRect = controls.getBoundingClientRect()
  const modelRect = model.getBoundingClientRect()
  const effortRect = effort.getBoundingClientRect()
  const controlsStyle = fixture.window.getComputedStyle(controls)
  const gap = Number.parseFloat(controlsStyle.columnGap)

  check(
    fixture.window.getComputedStyle(row).flexWrap === "wrap",
    "narrow row enables its responsive wrap",
  )
  check(controlsStyle.flexWrap === "nowrap", "narrow model and effort remain one control line")
  check(
    controlsRect.top >= copyRect.bottom - 1,
    "narrow controls wrap below their row label",
  )
  check(
    close(modelRect.top, effortRect.top, 1) &&
      close(modelRect.bottom, effortRect.bottom, 1),
    "narrow model and effort controls remain aligned",
  )
  check(
    close(modelRect.width + effortRect.width + gap, controlsRect.width, 1.5),
    "narrow model fills all width not reserved for effort",
  )
  check(modelRect.width >= 200, "narrow model control remains usable")
  check(
    controlsRect.left >= rowRect.left + 9 &&
      controlsRect.right <= rowRect.right - 7,
    "narrow controls stay inside row padding",
  )
  check(
    row.scrollWidth <= row.clientWidth + 1,
    "narrow row has no horizontal overflow",
  )

  return {
    narrowControlsWidth: rounded(controlsRect.width),
    narrowModelWidth: rounded(modelRect.width),
  }
}

function required<T extends Element = HTMLElement>(
  root: ParentNode,
  selector: string,
): T {
  const element = root.querySelector<T>(selector)
  if (!element) throw new Error(`Rendered UI is missing ${selector}`)
  return element
}

function check(
  condition: unknown,
  message: string,
): asserts condition {
  assertionCount++
  if (!condition) throw new Error(`Rendered UI assertion failed: ${message}`)
}

async function waitFor(
  condition: () => boolean,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error("Rendered UI did not reach the expected state before timeout")
}

function close(
  actual: number,
  expected: number,
  tolerance: number,
): boolean {
  return Math.abs(actual - expected) <= tolerance
}

function rounded(value: number): number {
  return Math.round(value * 10) / 10
}

function optionLabel(option: Element | undefined): string {
  return option?.textContent?.replace("✓", "").trim() ?? ""
}

function normalizeCssValue(value: string): string {
  return value.trim().replace(/\s+/g, " ")
}

function localCallbackUrl(value: string | null): URL {
  if (!value) throw new Error("Rendered UI test callback is required")
  const url = new URL(value)
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.username ||
    url.password
  ) {
    throw new Error("Rendered UI test callback must be an unauthenticated 127.0.0.1 HTTP URL")
  }
  return url
}

async function report(result: RenderedUiResult): Promise<void> {
  try {
    await fetch(callback, {
      method: "POST",
      // Keep this a CORS-safelisted request. The result collector is a second
      // loopback port and deliberately does not expose a general CORS surface.
      headers: { "content-type": "text/plain" },
      body: JSON.stringify(result),
    })
  } catch (error) {
    document.body.textContent = `Could not report rendered UI result: ${String(error)}`
  }
}

async function reportProgress(step: string): Promise<void> {
  const progress = new URL(callback)
  progress.pathname = "/progress"
  try {
    await fetch(progress, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: step,
    })
  } catch {
    // The final result reports any meaningful test failure. Progress reporting
    // exists only to make a browser or fixture startup failure diagnosable.
  }
}
