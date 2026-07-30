<script lang="ts">
  import { onMount, tick } from "svelte"
  import { WebviewWindow } from "@tauri-apps/api/webviewWindow"
  import { getCurrentWindow } from "@tauri-apps/api/window"
  import {
    APPLY_TO_ALL_TARGET,
    applyModelSelectionAction,
    buildModelSelectionSubmitParams,
    createModelSelectionState,
    filteredModelGroups,
    modelRefForValue,
    modelRefValue,
    modelSelectionInputKey,
    modelSelectionSubmitDisabled,
    shouldSubmitModelSelectionFromKeyboard,
    taskSelectionTarget,
    variantsForSelectionTarget,
  } from "./model-selection-reducer"
  import { createSetupState } from "./setup-reducer"
  import { resolveOpenCodeThemeCss } from "./opencode-theme-resolver"
  import { cssVariables, resolveTheme, themeTokens } from "./theme"
  import {
    getPickerRuntimeRequest,
    resolvePickerRuntimeData,
    resolvePickerThemeHint,
    type PickerModelSelectionInput,
    type PickerPreviewFixture,
    type PickerSetupInput,
  } from "./runtime-request"
  import { createTauriPickerRuntimeAdapter, type PickerRuntimeAdapter } from "./runtime-rpc"
  import EffortSelect from "./EffortSelect.svelte"
  import ModelSelect from "./ModelSelect.svelte"
  import NumberRow from "./NumberRow.svelte"
  import ToggleRow from "./ToggleRow.svelte"

  const isDevPreview = import.meta.env.DEV
  const maxBatchMs = 60_000
  const maxPickerTimeoutMs = 600_000
  const systemThemeMedia = "(prefers-color-scheme: light)"
  const decisionFailureMessage = "The picker could not complete the action. Please try again."
  const params = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search)
  let runtimeRequest = getPickerRuntimeRequest()
  const isPreviewWindow = isDevPreview && params.get("preview") === "1"
  let previewFixture: PickerPreviewFixture | undefined
  let modelState = createModelSelectionState({ tasks: [], models: [] })
  let systemPrefersLight =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(systemThemeMedia).matches
  $: runtimeData = resolvePickerRuntimeData(params, runtimeRequest, previewFixture)
  $: themeHint = resolvePickerThemeHint(params, runtimeRequest, runtimeData?.theme)
  $: resolvedOpenCodeTheme = resolveOpenCodeThemeCss(themeHint, systemPrefersLight)
  $: themeName = resolveTheme(resolvedOpenCodeTheme.mode)
  $: tokens = themeTokens[themeName]
  $: modelSelection = runtimeData?.modelSelection
  $: setup = runtimeData?.setup
  $: setupState = createSetupState({ settings: setup?.settings })
  $: taskCount = modelState.rows.length
  $: applyToAllGroups = filteredModelGroups(modelState, APPLY_TO_ALL_TARGET)
  $: activeView = isPreviewWindow && params.get("view") === "settings" ? "settings" : setup && !modelSelection ? "settings" : "models"
  $: windowTitle = isDevPreview && !isPreviewWindow ? "Model Dispatch" : activeView === "settings" ? "Model Dispatch Settings" : "Model Dispatch"
  let hydratedSelectionKey = ""
  let hydratedSetupKey = ""
  let runtimeAdapter: PickerRuntimeAdapter | undefined
  let allowWindowClose = false
  let decisionSent = false
  let sendingDecision = false
  let decisionError = ""
  let setupScope: "global" | "project" = "global"
  let addProjectConfigToGitignore = false
  $: dispatchEnabled = setupState.settings.dispatch.enabled
  $: privacyLoggingEnabled = setupState.settings.privacy.loggingEnabled
  $: batchMs = setupState.settings.dispatch.batchMs
  $: pickerTimeoutMs = setupState.settings.dispatch.pickerTimeoutMs
  $: setupValid =
    Number.isSafeInteger(batchMs) &&
    batchMs > 0 &&
    batchMs <= maxBatchMs &&
    Number.isSafeInteger(pickerTimeoutMs) &&
    pickerTimeoutMs > 0 &&
    pickerTimeoutMs <= maxPickerTimeoutMs
  $: hydrateModelSelection(modelSelection)
  $: hydrateSetup(setup)

  onMount(() => {
    let cleanup: (() => void) | undefined
    let disposed = false
    const systemThemeQuery =
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia(systemThemeMedia)
        : undefined
    const handleSystemThemeChange = (event: MediaQueryListEvent) => {
      systemPrefersLight = event.matches
    }
    systemPrefersLight = systemThemeQuery?.matches ?? false
    systemThemeQuery?.addEventListener("change", handleSystemThemeChange)

    void (async () => {
      if (isPreviewWindow) {
        previewFixture = (await import("./preview-fixture.json")).default
        return
      }
      if (isDevPreview) {
        if (hasTauriRuntime()) await revealPickerWindow()
        return
      }

      runtimeAdapter = await createTauriPickerRuntimeAdapter()
      const unlistenRuntime = await runtimeAdapter.start(async (request) => {
        runtimeRequest = request
        await tick()
        await revealPickerWindow()
      })
      const unlistenClose = await getCurrentWindow().onCloseRequested(async (event) => {
        if (allowWindowClose) return
        event.preventDefault()
        await cancelPicker()
      })
      if (disposed) {
        unlistenRuntime()
        unlistenClose()
      } else {
        cleanup = () => {
          unlistenRuntime()
          unlistenClose()
        }
      }
    })()
    return () => {
      disposed = true
      systemThemeQuery?.removeEventListener("change", handleSystemThemeChange)
      cleanup?.()
    }
  })

  function modelGroupsForRow(taskID: string) {
    return filteredModelGroups(modelState, taskSelectionTarget(taskID))
  }

  function hydrateModelSelection(input: PickerModelSelectionInput | undefined) {
    const key = modelSelectionInputKey(input)
    if (key === hydratedSelectionKey) return
    hydratedSelectionKey = key
    modelState = createModelSelectionState(input ?? { tasks: [], models: [] })
  }

  function hydrateSetup(input: PickerSetupInput | undefined) {
    const key = input
      ? [
          input.scope,
          input.projectIsGitRepo,
          input.projectConfigIgnored,
          input.settings.privacy.loggingEnabled,
          input.settings.dispatch.enabled,
          input.settings.dispatch.batchMs,
          input.settings.dispatch.pickerTimeoutMs,
        ].join("\u0000")
      : "none"
    if (key === hydratedSetupKey) return
    hydratedSetupKey = key
    setupScope = input?.scope ?? "global"
    addProjectConfigToGitignore = setupScope === "project" && input?.projectConfigIgnored === true
  }

  async function submitModelSelection() {
    if (modelSelectionSubmitDisabled(modelState)) return
    if (isDevPreview || isPreviewWindow) {
      closePreviewWindow()
      return
    }
    if (!runtimeAdapter) {
      decisionError = decisionFailureMessage
      return
    }
    await completeRuntimeDecision(() => runtimeAdapter!.submit(buildModelSelectionSubmitParams(modelState)))
  }

  async function submitSetup() {
    if (!setupValid) return
    if (isDevPreview || isPreviewWindow) {
      closePreviewWindow()
      return
    }
    if (!runtimeAdapter) {
      decisionError = decisionFailureMessage
      return
    }
    await completeRuntimeDecision(() =>
      runtimeAdapter!.submit({
        mode: "setup",
        scope: setupScope,
        settings: {
          privacy: { logging_enabled: privacyLoggingEnabled },
          dispatch: {
            enabled: dispatchEnabled,
            batch_ms: batchMs,
            picker_timeout_ms: pickerTimeoutMs,
            technical_failure: "default_model",
          },
        },
        addProjectConfigToGitignore: setupScope === "project" && addProjectConfigToGitignore,
      }),
    )
  }

  async function resetSetup() {
    if (isDevPreview || isPreviewWindow) {
      closePreviewWindow()
      return
    }
    if (!runtimeAdapter) {
      decisionError = decisionFailureMessage
      return
    }
    await completeRuntimeDecision(() =>
      runtimeAdapter!.submit({
        mode: "setup",
        action: "reset",
        scope: setupScope,
        addProjectConfigToGitignore: setupScope === "project" && addProjectConfigToGitignore,
      }),
    )
  }

  async function cancelPicker() {
    if (isDevPreview || isPreviewWindow) {
      closePreviewWindow()
      return
    }
    if (!runtimeAdapter) {
      decisionError = decisionFailureMessage
      return
    }
    await completeRuntimeDecision(() => runtimeAdapter!.cancel())
  }

  async function completeRuntimeDecision(send: () => Promise<void>) {
    if (sendingDecision || decisionSent) return
    sendingDecision = true
    decisionError = ""
    try {
      await send()
      decisionSent = true
      allowWindowClose = true
    } catch {
      decisionError = decisionFailureMessage
    } finally {
      sendingDecision = false
    }
    if (decisionSent) await closePickerWindow()
  }

  async function closePickerWindow() {
    try {
      await getCurrentWindow().close()
    } catch {
      decisionError = decisionFailureMessage
    }
  }

  async function requestPickerClose() {
    if (allowWindowClose) {
      await closePickerWindow()
      return
    }
    await cancelPicker()
  }

  function handleScopeChange() {
    if (setupScope === "project" && setup?.projectIsGitRepo) {
      addProjectConfigToGitignore = true
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault()
      void cancelPicker()
      return
    }
    if (activeView !== "models") return

    const target = event.target instanceof HTMLElement ? event.target : undefined
    if (!shouldSubmitModelSelectionFromKeyboard({
      key: event.key,
      defaultPrevented: event.defaultPrevented,
      targetTagName: target?.tagName,
      targetIsContentEditable: target?.isContentEditable,
    }, modelState)) return

    event.preventDefault()
    void submitModelSelection()
  }

  async function openPreviewWindow(view: "models" | "settings") {
    if (!isDevPreview || typeof window === "undefined") return
    const label = `preview-${view}`
    const existing = await WebviewWindow.getByLabel(label)
    if (existing) {
      await existing.setFocus()
      return
    }
    const url = new URL(window.location.href)
    url.searchParams.set("preview", "1")
    url.searchParams.set("view", view)
    url.searchParams.set("themeID", resolvedOpenCodeTheme.themeID)
    url.searchParams.set("colorScheme", resolvedOpenCodeTheme.mode)
    new WebviewWindow(label, {
      url: `${url.pathname}${url.search}`,
      title: view === "models" ? "Model Dispatch Preview" : "Model Dispatch Settings Preview",
      width: view === "models" ? 680 : 800,
      height: view === "models" ? 500 : 560,
      center: true,
      decorations: false,
      shadow: true,
      transparent: true,
      theme: themeName,
      resizable: true,
      focus: true,
    })
  }

  function closePreviewWindow() {
    if (typeof window === "undefined") return
    void WebviewWindow.getCurrent().close()
  }

  function minimizeWindow() {
    if (typeof window === "undefined") return
    void getCurrentWindow().minimize()
  }

  function toggleMaximizeWindow() {
    if (typeof window === "undefined") return
    void getCurrentWindow().toggleMaximize()
  }

  function startWindowDrag() {
    if (typeof window === "undefined") return
    void getCurrentWindow().startDragging()
  }

  function hasTauriRuntime() {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
  }

  async function revealPickerWindow() {
    const pickerWindow = getCurrentWindow()
    await pickerWindow.show()
    void pickerWindow.setFocus().catch(() => undefined)
  }

  function setAllModels(value: string) {
    setModel(APPLY_TO_ALL_TARGET, value)
  }

  function setAllVariants(value: string) {
    modelState = applyModelSelectionAction(modelState, {
      type: "selectVariant",
      target: APPLY_TO_ALL_TARGET,
      variant: value,
    })
  }

  function setRowModel(taskID: string, value: string) {
    setModel(taskSelectionTarget(taskID), value)
  }

  function setRowVariant(taskID: string, value: string) {
    modelState = applyModelSelectionAction(modelState, {
      type: "selectVariant",
      target: taskSelectionTarget(taskID),
      variant: value,
    })
  }

  function setModel(target: string, value: string) {
    const model = modelRefForValue(modelState, target, value)
    if (!model) return
    modelState = applyModelSelectionAction(modelState, {
      type: "selectModel",
      target,
      model,
    })
  }
</script>

<svelte:head>
  <title>OpenCode Model Dispatch Picker</title>
</svelte:head>

<svelte:window on:keydown={handleKeydown} />

<section
  class="shell"
  class:preview-shell={isPreviewWindow}
  style={cssVariables(tokens, { mode: themeName, cssText: resolvedOpenCodeTheme.cssText, cssVariables: resolvedOpenCodeTheme.cssVariables })}
  data-theme={resolvedOpenCodeTheme.themeID}
  data-color-scheme={themeName}
>
  {#if !isPreviewWindow}
    <header class="app-chrome" role="presentation" on:mousedown={startWindowDrag}>
      <div class="chrome-left">
        <span class="app-icon" aria-hidden="true"></span>
        <span>{windowTitle}</span>
      </div>
      <div class="chrome-controls" role="presentation" on:mousedown|stopPropagation>
        <button type="button" aria-label="Minimize" on:click={minimizeWindow}>−</button>
        <button type="button" aria-label="Maximize" on:click={toggleMaximizeWindow}>□</button>
        <button type="button" aria-label="Close" disabled={sendingDecision} on:click={requestPickerClose}>×</button>
      </div>
    </header>
  {/if}
  <div data-component={isPreviewWindow ? "dialog-v2" : undefined} class:panel={!isPreviewWindow} class:preview-panel={isPreviewWindow}>
    {#if isDevPreview && !isPreviewWindow}
      <p class="eyebrow">Development</p>
      <h1>Preview Launcher</h1>
      <p class="summary">Open the real fixture-backed preview in separate Tauri windows. This launcher only exists in dev mode.</p>
      <div class="launcher-actions">
        <button type="button" on:click={() => openPreviewWindow("models")}>Open model picker</button>
        <button type="button" on:click={() => openPreviewWindow("settings")}>Open settings</button>
      </div>
    {:else if activeView === "models"}
      <section class="picker-window" aria-labelledby="models-title" aria-busy={sendingDecision}>
        <header class="real-window-heading">
          <div>
            <h1 id="models-title">Choose models</h1>
            <p>{taskCount} queued task calls</p>
          </div>
          <span>{taskCount} tasks</span>
        </header>

        {#if !runtimeData}
          <div class="empty-state">
            <h2>Waiting for picker request</h2>
            <p>No runtime model-selection request has been received yet.</p>
          </div>
        {:else}

        <div class="model-list">
          <div class="model-row apply-row">
            <span class="model-row-copy">
              <strong>Apply to all</strong>
              <small>Set one model for this batch.</small>
            </span>
            <div class="model-controls">
              <ModelSelect value={modelRefValue(modelState.applyToAllModel)} groups={applyToAllGroups} ariaLabel="Apply model to all tasks" onChange={setAllModels} />
              <EffortSelect
                value={modelState.applyToAllModel?.variant ?? ""}
                variants={variantsForSelectionTarget(modelState, APPLY_TO_ALL_TARGET)}
                ariaLabel="Apply effort to all tasks"
                onChange={setAllVariants}
              />
            </div>
          </div>

          {#each modelState.rows as row}
            <div class="model-row">
              <span class="model-row-copy">
                <strong>{row.agentType}</strong>
                {#if row.description}
                  <small title={row.description}>{row.description}</small>
                {/if}
              </span>
              <div class="model-controls">
                <ModelSelect value={modelRefValue(modelState.selections[row.id])} groups={modelGroupsForRow(row.id)} ariaLabel={`Model for ${row.agentType}`} onChange={(value) => setRowModel(row.id, value)} />
                <EffortSelect
                  value={modelState.selections[row.id]?.variant ?? ""}
                  variants={variantsForSelectionTarget(modelState, taskSelectionTarget(row.id))}
                  ariaLabel={`Effort for ${row.agentType}`}
                  onChange={(value) => setRowVariant(row.id, value)}
                />
              </div>
            </div>
          {/each}
        </div>
        {/if}

        <footer class="window-actions">
          {#if decisionError}<p class="decision-error" role="alert">{decisionError}</p>{/if}
          <button type="button" class="secondary" disabled={sendingDecision || decisionSent} on:click={cancelPicker}>Cancel</button>
          <button type="button" class="primary" disabled={sendingDecision || decisionSent || modelSelectionSubmitDisabled(modelState)} on:click={submitModelSelection}>Start tasks</button>
        </footer>
      </section>
    {:else}
      <section class="settings-window" aria-labelledby="settings-title" aria-busy={sendingDecision}>
        <div class="settings-main">
          <h1 id="settings-title" class="settings-title">Model Dispatch Settings</h1>

          <div class="settings-panel">
            <label class="scope-row">
              <span class="scope-copy">
                <strong>Configuration scope</strong>
                <small>Privacy logging stays global; dispatch settings can apply globally or only to this project.</small>
              </span>
              <select bind:value={setupScope} aria-label="Configuration scope" on:change={handleScopeChange}>
                <option value="global">Global</option>
                <option value="project">This project</option>
              </select>
            </label>
            <ToggleRow
              label="Enable model dispatch"
              description="Pause task calls and choose the model before subagents start."
              checked={dispatchEnabled}
              onChange={(checked) => (dispatchEnabled = checked)}
            />
            <NumberRow
              label="Batch window"
              description="How long parallel task calls are grouped into one model picker."
              value={batchMs}
              suffix="ms"
              onChange={(value) => (batchMs = value)}
            />
            <NumberRow
              label="Picker timeout"
              description="How long to wait for the picker window to start and connect."
              value={pickerTimeoutMs}
              suffix="ms"
              onChange={(value) => (pickerTimeoutMs = value)}
            />
            <ToggleRow
              label="Privacy-safe logging"
              description="Write operational events globally. Task prompt text is never logged."
              checked={privacyLoggingEnabled}
              onChange={(checked) => (privacyLoggingEnabled = checked)}
            />
            {#if setupScope === "project" && setup?.projectIsGitRepo}
              <ToggleRow
                label="Ignore project dispatch config"
                description="Add .opencode/model-dispatch.json to this project's .gitignore."
                checked={addProjectConfigToGitignore}
                onChange={(checked) => (addProjectConfigToGitignore = checked)}
              />
            {:else if setupScope === "project"}
              <p class="scope-notice">This directory is not a Git repository, so no .gitignore update is needed.</p>
            {/if}
          </div>

          <footer class="window-actions settings-actions">
            {#if decisionError}<p class="decision-error" role="alert">{decisionError}</p>{/if}
            <button type="button" class="secondary" disabled={sendingDecision || decisionSent} on:click={cancelPicker}>Cancel</button>
            <button type="button" class="secondary" disabled={sendingDecision || decisionSent} on:click={resetSetup}>Reset defaults</button>
            <button type="button" class="primary" disabled={sendingDecision || decisionSent || !setupValid} on:click={submitSetup}>Save changes</button>
          </footer>
        </div>
      </section>
    {/if}
  </div>
</section>

<style>
  :global(body) {
    margin: 0;
    background: transparent;
    font-family: ui-sans-serif, system-ui, sans-serif;
  }

  :global(html) {
    background: transparent;
  }

  .shell {
    min-height: 100vh;
    box-sizing: border-box;
    background: var(--v2-background-bg-base);
    color: var(--v2-text-text-base);
    color-scheme: dark;
  }

  .shell[data-color-scheme="light"] {
    color-scheme: light;
  }

  .preview-shell {
    display: flex;
    min-height: 100vh;
    padding: 0;
    background: transparent;
  }

  .shell,
  .settings-main,
  .picker-window {
    scrollbar-width: none;
    -ms-overflow-style: none;
  }

  .shell::-webkit-scrollbar,
  .settings-main::-webkit-scrollbar,
  .picker-window::-webkit-scrollbar {
    display: none;
  }

  .app-chrome {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 40px;
    padding-left: 12px;
    border-bottom: 1px solid var(--v2-border-border-base);
    background: var(--v2-background-bg-layer-01);
    color: var(--v2-text-text-base);
    user-select: none;
  }

  .chrome-left {
    display: inline-flex;
    align-items: center;
    min-width: 0;
    gap: 8px;
    font-size: 12px;
    font-weight: 530;
  }

  .app-icon {
    width: 14px;
    height: 14px;
    border-radius: 3px;
    background: linear-gradient(90deg, var(--v2-text-text-base) 0 42%, transparent 42% 58%, var(--v2-text-text-base) 58% 100%);
  }

  .chrome-controls {
    display: flex;
    height: 100%;
  }

  .chrome-controls button {
    width: 46px;
    border: 0;
    background: transparent;
    color: var(--v2-text-text-muted);
    font: inherit;
    font-size: 14px;
  }

  .chrome-controls button:hover {
    background: var(--v2-background-bg-layer-03);
    color: var(--v2-text-text-base);
  }

  .chrome-controls button:last-child:hover {
    background: var(--v2-text-text-danger);
    color: var(--v2-text-text-contrast);
  }

  .panel {
    max-width: 760px;
    margin: 18px auto 0;
    border: 1px solid var(--v2-border-border-base);
    border-radius: 14px;
    padding: 18px;
    background: var(--v2-background-bg-layer-01);
  }

  .preview-panel {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100vh;
    margin: 0;
    overflow: hidden;
    border-radius: 0;
    background: var(--v2-background-bg-layer-01);
    box-shadow: none;
    pointer-events: auto;
  }

  .preview-panel:has(.settings-window) {
    max-width: none;
  }

  .eyebrow {
    margin: 0 0 6px;
    color: var(--v2-text-text-accent);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  h1 {
    margin: 0 0 8px;
    font-size: 20px;
  }

  .summary {
    margin: 0 0 16px;
    max-width: 68ch;
    color: var(--v2-text-text-muted);
  }

  .launcher-actions {
    display: grid;
    gap: 10px;
    margin-top: 16px;
    max-width: 280px;
  }

  .launcher-actions button,
  .window-actions button {
    border: 0.5px solid var(--v2-border-border-muted);
    border-radius: 8px;
    padding: 10px 12px;
    background: var(--v2-background-bg-layer-01);
    color: var(--v2-text-text-base);
    font: inherit;
    font-size: 13px;
    font-weight: 530;
    cursor: pointer;
    transition: background-color 120ms ease-out, border-color 120ms ease-out, color 120ms ease-out, opacity 120ms ease-out;
  }

  .launcher-actions button:hover,
  .window-actions button:hover:not(:disabled) {
    background: var(--v2-background-bg-layer-03);
    border-color: var(--v2-border-border-base);
  }

  .launcher-actions button:active,
  .window-actions button:active:not(:disabled) {
    background: var(--v2-background-bg-layer-02);
    transform: translateY(1px);
  }

  .launcher-actions button:focus-visible,
  .window-actions button:focus-visible {
    outline: 1.5px solid var(--v2-border-border-focus);
    outline-offset: 2px;
  }

  .window-actions button:disabled {
    cursor: not-allowed;
    opacity: 0.42;
  }

  .real-window-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 10px;
  }

  .real-window-heading h1 {
    margin: 0;
    font-size: 13px;
    font-weight: 560;
    line-height: 1;
  }

  .real-window-heading p {
    margin: 5px 0 0;
    color: var(--v2-text-text-muted);
    font-size: 11px;
  }

  .real-window-heading > span {
    color: var(--v2-text-text-muted);
    font-size: 11px;
    font-weight: 520;
  }

  .picker-window {
    display: flex;
    min-height: 0;
    flex: 1;
    flex-direction: column;
    overflow: auto;
    padding: 14px;
    background: var(--v2-background-bg-base);
  }

  .model-list {
    overflow: visible;
    border: 0.5px solid var(--v2-border-border-muted);
    border-radius: 6px;
    background: var(--v2-background-bg-layer-01);
  }

  .model-row {
    display: flex;
    flex-wrap: nowrap;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    padding: 6px 8px 6px 10px;
    border-bottom: 0.5px solid var(--v2-border-border-base);
    transition: background-color 120ms ease-out, box-shadow 120ms ease-out;
  }

  .model-row:hover {
    background: var(--v2-background-bg-layer-02);
  }

  .model-row:focus-within {
    background: var(--v2-background-bg-layer-02);
    box-shadow: inset 0 0 0 1px var(--v2-border-border-focus);
  }

  .model-row:last-child {
    border-bottom: 0;
  }

  .model-row-copy {
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
    gap: 3px;
  }

  .model-controls {
    display: flex;
    flex-wrap: nowrap;
    width: min(420px, 66%);
    min-width: 0;
    flex: 0 1 420px;
    align-items: center;
    gap: 6px;
  }

  .model-controls :global(.model-select) {
    width: auto;
    min-width: 0;
    flex: 1 1 auto;
  }

  .model-controls :global(.effort-select) {
    width: 152px;
    min-width: 152px;
    flex: 0 0 152px;
  }

  .model-row strong {
    font-size: 12px;
    font-weight: 540;
    line-height: 1;
    color: var(--v2-text-text-base);
  }

  .model-row small {
    overflow: hidden;
    color: var(--v2-text-text-muted);
    font-size: 11px;
    font-weight: 440;
    line-height: 1.2;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .apply-row {
    background: color-mix(in oklch, var(--v2-background-bg-layer-03), transparent 68%);
  }

  .settings-window {
    display: flex;
    min-height: 0;
    flex: 1;
    flex-direction: column;
    overflow: hidden;
    background: var(--v2-background-bg-layer-01);
  }

  .settings-main {
    width: min(680px, 100%);
    margin: 0 auto;
    padding: 22px 18px 18px;
    overflow-y: auto;
    flex: 1;
  }

  .settings-title {
    margin-bottom: 18px;
    font-size: 13px;
    font-weight: 640;
    line-height: 1;
  }

  .settings-panel {
    overflow: hidden;
    border-radius: 8px;
    padding-inline: 14px;
    background: var(--v2-background-bg-base);
    box-shadow: inset 0 0 0 0.5px var(--v2-border-border-muted);
  }

  .scope-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding-block: 13px;
    border-bottom: 0.5px solid var(--v2-border-border-base);
  }

  .scope-copy {
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
    gap: 5px;
  }

  .scope-copy strong {
    color: var(--v2-text-text-base);
    font-size: 12px;
    font-weight: 530;
  }

  .scope-copy small,
  .scope-notice {
    color: var(--v2-text-text-muted);
    font-size: 10.5px;
    line-height: 1.25;
  }

  .scope-row select {
    min-height: 32px;
    border: 0.5px solid var(--v2-border-border-muted);
    border-radius: 6px;
    padding: 6px 8px;
    background: var(--v2-background-bg-base);
    color: var(--v2-text-text-base);
    font: inherit;
    font-size: 12px;
  }

  .scope-notice {
    margin: 0;
    padding-block: 13px;
  }

  @media (max-width: 540px) {
    .model-row {
      flex-wrap: wrap;
    }

    .model-controls {
      width: 100%;
      min-width: 0;
      flex: 1 0 100%;
    }
  }

  @media (max-width: 720px) {
    .settings-main {
      padding: 18px;
    }
  }

  .window-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    margin-top: auto;
    padding-top: 18px;
  }

  .settings-actions {
    margin-top: 14px;
  }

  .decision-error {
    margin: 0 auto 0 0;
    color: var(--v2-text-text-danger);
    font-size: 11px;
    line-height: 1.3;
  }

  .picker-window .window-actions {
    border-top: 0.5px solid var(--v2-border-border-muted);
    margin-top: 12px;
    padding-top: 10px;
  }

  .picker-window .window-actions button {
    border-radius: 6px;
    padding: 7px 10px;
    font-size: 12px;
  }

  .window-actions .primary {
    background: var(--v2-text-text-base);
    color: var(--v2-background-bg-base);
  }

  .window-actions .primary:hover:not(:disabled) {
    background: var(--v2-text-text-muted);
  }

  .window-actions .primary:active:not(:disabled) {
    background: var(--v2-text-text-faint);
  }

  .window-actions .secondary {
    background: transparent;
  }
</style>
