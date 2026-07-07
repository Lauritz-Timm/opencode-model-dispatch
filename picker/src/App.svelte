<script lang="ts">
  import { onMount } from "svelte"
  import { WebviewWindow } from "@tauri-apps/api/webviewWindow"
  import { getCurrentWindow } from "@tauri-apps/api/window"
  import { buildModelSelectionSubmitParams, createModelSelectionState, filteredModelGroups, modelSelectionSubmitDisabled, shouldSubmitModelSelectionFromKeyboard, type ModelRef } from "./model-selection-reducer"
  import { createSetupState } from "./setup-reducer"
  import { resolveOpenCodeThemeCss } from "./opencode-theme-resolver"
  import { cssVariables, resolveTheme, themeTokens } from "./theme"
  import { getPickerRuntimeRequest, resolvePickerRuntimeData, resolvePickerThemeHint, type PickerPreviewFixture } from "./runtime-request"
  import { createTauriPickerRuntimeAdapter, type PickerRuntimeAdapter } from "./runtime-rpc"
  import NumberRow from "./NumberRow.svelte"
  import ToggleRow from "./ToggleRow.svelte"

  const isDevPreview = import.meta.env.DEV
  const params = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search)
  let runtimeRequest = getPickerRuntimeRequest()
  const isPreviewWindow = isDevPreview && params.get("preview") === "1"
  let previewFixture: PickerPreviewFixture | undefined
  $: runtimeData = resolvePickerRuntimeData(params, runtimeRequest, previewFixture)
  $: themeHint = resolvePickerThemeHint(params, runtimeRequest, runtimeData?.theme)
  $: resolvedOpenCodeTheme = resolveOpenCodeThemeCss(themeHint)
  $: themeName = resolveTheme(resolvedOpenCodeTheme.mode)
  $: tokens = themeTokens[themeName]
  $: modelSelection = runtimeData?.modelSelection
  $: setup = runtimeData?.setup
  $: modelState = createModelSelectionState(modelSelection ?? { tasks: [], models: [] })
  $: setupState = createSetupState({ settings: setup?.settings })
  $: taskCount = modelSelection?.tasks.length ?? 0
  $: modelGroups = filteredModelGroups(modelState)
  $: activeView = isPreviewWindow && params.get("view") === "settings" ? "settings" : setup && !modelSelection ? "settings" : "models"
  $: windowTitle = isDevPreview && !isPreviewWindow ? "Model Dispatch" : activeView === "settings" ? "Model Dispatch Settings" : "Model Dispatch"
  $: modelOptions = modelSelection?.models ?? []
  let selectedModels: Record<string, string> = {}
  let runtimeAdapter: PickerRuntimeAdapter | undefined
  $: dispatchEnabled = setupState.settings.dispatch.enabled
  $: privacyLoggingEnabled = setupState.settings.privacy.loggingEnabled
  $: batchMs = setupState.settings.dispatch.batchMs
  $: pickerTimeoutMs = setupState.settings.dispatch.pickerTimeoutMs

  onMount(async () => {
    if (isPreviewWindow) {
      previewFixture = (await import("./preview-fixture.json")).default
      return
    }
    if (isDevPreview) return

    runtimeAdapter = await createTauriPickerRuntimeAdapter()
    return await runtimeAdapter.start((request) => (runtimeRequest = request))
  })

  function modelRefFromValue(value: string | undefined): ModelRef | undefined {
    if (!value) return undefined
    const model = modelOptions.find((candidate) => `${candidate.providerID}/${candidate.modelID}` === value)
    return model ? { providerID: model.providerID, modelID: model.modelID } : undefined
  }

  function currentModelSelectionState() {
    const selections: Record<string, ModelRef> = {}
    for (const row of modelState.rows) {
      const model = modelRefFromValue(selectedModels[row.id])
      if (model) selections[row.id] = model
    }
    return { ...modelState, selections }
  }

  async function submitModelSelection() {
    const state = currentModelSelectionState()
    if (modelSelectionSubmitDisabled(state)) return
    if (isDevPreview || isPreviewWindow || !runtimeAdapter) {
      closePreviewWindow()
      return
    }
    await runtimeAdapter.submit(buildModelSelectionSubmitParams(state))
    await getCurrentWindow().close()
  }

  async function cancelPicker() {
    if (isDevPreview || isPreviewWindow || !runtimeAdapter) {
      closePreviewWindow()
      return
    }
    await runtimeAdapter.cancel()
    await getCurrentWindow().close()
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault()
      void cancelPicker()
      return
    }

    const target = event.target instanceof HTMLElement ? event.target : undefined
    if (!shouldSubmitModelSelectionFromKeyboard({
      key: event.key,
      defaultPrevented: event.defaultPrevented,
      targetTagName: target?.tagName,
      targetIsContentEditable: target?.isContentEditable,
    }, currentModelSelectionState())) return

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
      theme: "dark",
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

  function selectedModelLabel(taskID: string): string {
    const selected = modelOptions.find((model) => `${model.providerID}/${model.modelID}` === selectedModels[taskID])
    return selected ? `${selected.providerName} · ${selected.displayName}` : "Select model"
  }

  function setAllModels(value: string) {
    selectedModels = Object.fromEntries(modelState.rows.map((row) => [row.id, value]))
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
        <button type="button" aria-label="Close" on:click={cancelPicker}>×</button>
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
      <section class="picker-window" aria-labelledby="models-title">
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
          <label class="model-row apply-row">
            <span>
              <strong>Apply to all</strong>
              <small>Set one model for this batch.</small>
            </span>
            <select on:change={(event) => setAllModels(event.currentTarget.value)}>
              <option value="">Select model</option>
              {#each modelGroups as group}
                <optgroup label={group.providerName}>
                  {#each group.models as model}
                    <option value={`${model.providerID}/${model.modelID}`}>{model.displayName}</option>
                  {/each}
                </optgroup>
              {/each}
            </select>
          </label>

          {#each modelState.rows as row}
            <label class="model-row">
              <span>
                <strong>{row.agentType}</strong>
                <small>{row.description}</small>
              </span>
              <select bind:value={selectedModels[row.id]} aria-label={`Model for ${row.agentType}`}>
                <option value="">{selectedModelLabel(row.id)}</option>
                {#each modelGroups as group}
                  <optgroup label={group.providerName}>
                    {#each group.models as model}
                      <option value={`${model.providerID}/${model.modelID}`}>{model.displayName}</option>
                    {/each}
                  </optgroup>
                {/each}
              </select>
            </label>
          {/each}
        </div>
        {/if}

        <footer class="window-actions">
          <button type="button" class="secondary" on:click={cancelPicker}>Cancel</button>
          <button type="button" class="primary" disabled={modelSelectionSubmitDisabled(currentModelSelectionState())} on:click={submitModelSelection}>Start tasks</button>
        </footer>
      </section>
    {:else}
      <section class="settings-window" aria-labelledby="settings-title">
        <div class="settings-main">
          <h1 id="settings-title" class="settings-title">Model Dispatch Settings</h1>

          <div class="settings-panel">
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
              description="Maximum time to wait for the picker process before falling back."
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
          </div>

          <footer class="window-actions settings-actions">
            <button type="button" class="secondary" on:click={closePreviewWindow}>Cancel</button>
            <button type="button" class="primary" on:click={closePreviewWindow}>Save changes</button>
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
    color: var(--opencode-text);
    font-family: ui-sans-serif, system-ui, sans-serif;
  }

  :global(html) {
    background: transparent;
  }

  .shell {
    min-height: 100vh;
    box-sizing: border-box;
    background: var(--opencode-bg);
    color: var(--opencode-text);
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
    background: var(--v2-background-bg-layer-01, var(--opencode-surface));
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
    background: var(--v2-text-text-danger, var(--opencode-danger));
    color: var(--v2-background-bg-base);
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
    background: var(--v2-background-bg-layer-01, var(--opencode-surface));
    box-shadow: none;
    pointer-events: auto;
  }

  .preview-panel:has(.settings-window) {
    max-width: none;
  }

  .eyebrow {
    margin: 0 0 6px;
    color: var(--opencode-accent);
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
    color: var(--opencode-muted);
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
    outline: 1.5px solid var(--v2-border-border-active, var(--opencode-accent));
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
    overflow: hidden;
    border: 0.5px solid var(--v2-border-border-muted);
    border-radius: 6px;
    background: var(--v2-background-bg-layer-01);
  }

  .model-row {
    display: flex;
    flex-wrap: nowrap;
    align-items: center;
    gap: 12px;
    min-height: 44px;
    padding: 7px 8px 7px 10px;
    border-bottom: 0.5px solid var(--v2-border-border-base);
    transition: background-color 120ms ease-out, box-shadow 120ms ease-out;
  }

  .model-row:hover {
    background: var(--v2-background-bg-layer-02, var(--v2-background-bg-layer-03));
  }

  .model-row:focus-within {
    background: var(--v2-background-bg-layer-02, var(--v2-background-bg-layer-03));
    box-shadow: inset 0 0 0 1px var(--v2-border-border-active, var(--opencode-accent));
  }

  .model-row:last-child {
    border-bottom: 0;
  }

  .model-row span {
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
    gap: 3px;
  }

  .model-row strong {
    font-size: 12px;
    font-weight: 540;
    line-height: 1;
    color: var(--v2-text-text-base);
  }

  .model-row small {
    color: var(--v2-text-text-muted);
    font-size: 11px;
    font-weight: 440;
    line-height: 1.2;
  }

  .model-row select {
    width: 220px;
    max-width: 100%;
    border: 0.5px solid var(--v2-border-border-muted);
    border-radius: 6px;
    padding: 6px 28px 6px 8px;
    appearance: none;
    background:
      linear-gradient(45deg, transparent 50%, var(--v2-text-text-muted) 50%) calc(100% - 14px) 50% / 5px 5px no-repeat,
      linear-gradient(135deg, var(--v2-text-text-muted) 50%, transparent 50%) calc(100% - 9px) 50% / 5px 5px no-repeat,
      var(--v2-background-bg-base);
    color: var(--v2-text-text-base);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
    transition: background-color 120ms ease-out, border-color 120ms ease-out, box-shadow 120ms ease-out;
  }

  .model-row select:hover {
    border-color: var(--v2-border-border-base);
    background:
      linear-gradient(45deg, transparent 50%, var(--v2-text-text-muted) 50%) calc(100% - 14px) 50% / 5px 5px no-repeat,
      linear-gradient(135deg, var(--v2-text-text-muted) 50%, transparent 50%) calc(100% - 9px) 50% / 5px 5px no-repeat,
      var(--v2-background-bg-layer-01);
  }

  .model-row select:active {
    border-color: var(--v2-border-border-active, var(--opencode-accent));
  }

  .model-row select:focus-visible {
    outline: 1.5px solid var(--v2-border-border-active, var(--opencode-accent));
    outline-offset: 1px;
    border-color: var(--v2-border-border-active, var(--opencode-accent));
  }

  .model-row select:disabled {
    cursor: not-allowed;
    opacity: 0.45;
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

  @media (max-width: 720px) {
    .model-row {
      flex-wrap: wrap;
    }

    .model-row select {
      width: 100%;
    }

    .settings-main {
      padding: 18px;
    }
  }

  .window-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: auto;
    padding-top: 18px;
  }

  .settings-actions {
    margin-top: 14px;
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
    background: var(--v2-text-text-subtle, var(--v2-text-text-muted));
  }

  .window-actions .secondary {
    background: transparent;
  }
</style>
