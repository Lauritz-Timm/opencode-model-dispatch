<script context="module" lang="ts">
  let modelSelectSequence = 0
</script>

<script lang="ts">
  import { tick } from "svelte"
  import {
    modelRefValue,
    type PickerModel,
  } from "./model-selection-reducer"
  import {
    escapeModelIdentifier,
    formatModelAccessibleLabel,
    formatModelIdentity,
  } from "./model-identity"

  export let value = ""
  export let groups: Array<{ providerID: string; providerName: string; models: PickerModel[] }> = []
  export let ariaLabel = "Model"
  export let onChange: (value: string) => void = () => {}

  const instanceID = `model-select-${modelSelectSequence++}`
  const listboxID = `${instanceID}-listbox`
  let open = false
  let search = ""
  let root: HTMLDivElement
  let triggerButton: HTMLButtonElement
  let searchInput: HTMLInputElement
  let activeIndex = 0
  let openAbove = false

  $: selectedModel = groups.flatMap((group) => group.models).find((model) => modelValue(model) === value)
  $: selectedLabel = selectedModel ? selectedModel.displayName : "Select model"
  $: selectedIdentity = selectedModel ? formatModelIdentity(selectedModel) : ""
  $: filteredGroups = filterGroups(groups, search)
  $: filteredModels = filteredGroups.flatMap((group) => group.models)

  function modelValue(model: PickerModel): string {
    return modelRefValue(model)
  }

  function filterGroups(source: typeof groups, query: string) {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return source

    return source
      .map((group) => ({
        ...group,
        models: group.models.filter((model) => `${group.providerName} ${group.providerID} ${model.displayName} ${model.modelID}`.toLowerCase().includes(normalized)),
      }))
      .filter((group) => group.models.length > 0)
  }

  async function openDropdown() {
    const bounds = root?.getBoundingClientRect()
    openAbove = Boolean(bounds && window.innerHeight - bounds.bottom < 330 && bounds.top > window.innerHeight - bounds.bottom)
    open = true
    search = ""
    const selectedIndex = groups.flatMap((group) => group.models).findIndex((model) => modelValue(model) === value)
    activeIndex = Math.max(0, selectedIndex)
    await tick()
    searchInput?.focus()
  }

  function closeDropdown(restoreTriggerFocus = false) {
    open = false
    search = ""
    if (restoreTriggerFocus) void tick().then(() => triggerButton?.focus())
  }

  function handleTriggerClick() {
    if (open) closeDropdown()
    else void openDropdown()
  }

  function selectModel(nextValue: string) {
    value = nextValue
    onChange(nextValue)
    closeDropdown(true)
  }

  function handleDocumentPointerDown(event: PointerEvent) {
    if (!open || root?.contains(event.target as Node)) return
    closeDropdown()
  }

  function handleKeydown(event: KeyboardEvent) {
    if (!open) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault()
        event.stopPropagation()
        void openDropdown()
      }
      return
    }

    if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      closeDropdown(true)
      return
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
      event.preventDefault()
      event.stopPropagation()
      if (filteredModels.length === 0) return
      if (event.key === "Home") activeIndex = 0
      else if (event.key === "End") activeIndex = filteredModels.length - 1
      else {
        const delta = event.key === "ArrowDown" ? 1 : -1
        activeIndex = (activeIndex + delta + filteredModels.length) % filteredModels.length
      }
      void tick().then(() => root?.querySelector<HTMLElement>(`[data-option-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" }))
      return
    }

    if (event.key === "Enter" && filteredModels.length > 0) {
      event.preventDefault()
      event.stopPropagation()
      selectModel(modelValue(filteredModels[Math.min(activeIndex, filteredModels.length - 1)]!))
    }
  }

  function handleSearchInput() {
    activeIndex = 0
  }
</script>

<svelte:document on:pointerdown={handleDocumentPointerDown} />

<div bind:this={root} class="model-select">
  <button bind:this={triggerButton} type="button" class="selector-button" aria-label={selectedModel ? `${ariaLabel}: ${formatModelAccessibleLabel(selectedModel)}` : ariaLabel} title={selectedModel ? formatModelAccessibleLabel(selectedModel) : undefined} aria-haspopup="listbox" aria-expanded={open} aria-controls={listboxID} on:click={handleTriggerClick} on:keydown={handleKeydown}>
    <span class="selector-label">
      <span class="selector-name">{selectedLabel}</span>
      {#if selectedModel}
        <span class="model-identity" dir="ltr">{selectedIdentity}</span>
      {/if}
    </span>
    <span class="selector-affordances" aria-hidden="true">
      {#if selectedModel}<span class="selector-check">✓</span>{/if}
      <span class="selector-chevron">⌄</span>
    </span>
  </button>

  {#if open}
    <div class="model-popover" class:open-above={openAbove}>
      <div class="search-row">
        <span class="search-icon" aria-hidden="true">⌕</span>
        <input
          bind:this={searchInput}
          bind:value={search}
          on:input={handleSearchInput}
          on:keydown={handleKeydown}
          type="search"
          role="combobox"
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listboxID}
          aria-activedescendant={filteredModels[activeIndex] ? `${listboxID}-option-${activeIndex}` : undefined}
          placeholder="Search models"
          aria-label="Search models"
        />
      </div>

      <div id={listboxID} class="model-options" role="listbox" aria-label={ariaLabel}>
        {#each filteredGroups as group}
          <div class="provider-heading" role="presentation">
            <span>{group.providerName}</span>
            <span class="identity-separator" aria-hidden="true">·</span>
            <span class="provider-id" dir="ltr">{escapeModelIdentifier(group.providerID)}</span>
          </div>
          {#each group.models as model}
            {@const optionValue = modelValue(model)}
            {@const optionIndex = filteredModels.indexOf(model)}
            <button id={`${listboxID}-option-${optionIndex}`} data-option-index={optionIndex} type="button" tabindex="-1" class="model-option" class:selected={optionValue === value} class:active={optionIndex === activeIndex} role="option" aria-label={formatModelAccessibleLabel(model)} title={formatModelAccessibleLabel(model)} aria-selected={optionValue === value} on:focus={() => (activeIndex = optionIndex)} on:mouseenter={() => (activeIndex = optionIndex)} on:keydown={handleKeydown} on:click={() => selectModel(optionValue)}>
              <span class="model-option-copy">
                <span class="model-option-label">{model.displayName}</span>
                <span class="model-identity" dir="ltr">{formatModelIdentity(model)}</span>
              </span>
              {#if optionValue === value}<span class="selected-check" aria-hidden="true">✓</span>{/if}
            </button>
          {/each}
        {:else}
          <div class="empty-options">No models found</div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .model-select {
    position: relative;
    width: 100%;
    min-width: 0;
  }

  .selector-button {
    display: inline-flex;
    width: 100%;
    height: 30px;
    min-height: 30px;
    box-sizing: border-box;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    border: 0.5px solid var(--v2-border-border-muted);
    border-radius: 6px;
    padding: 6px 8px;
    background: var(--v2-background-bg-base);
    color: var(--v2-text-text-base);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
    transition: background-color 120ms ease-out, border-color 120ms ease-out, box-shadow 120ms ease-out;
  }

  .selector-button:hover,
  .selector-button[aria-expanded="true"] {
    border-color: var(--v2-border-border-base);
    background: var(--v2-background-bg-layer-01);
  }

  .selector-button:focus-visible {
    outline: 1.5px solid var(--v2-border-border-focus);
    outline-offset: 1px;
  }

  .selector-label {
    display: flex;
    flex: 1 1 auto;
    align-items: baseline;
    gap: 7px;
    overflow: hidden;
    min-width: 0;
    white-space: nowrap;
  }

  .selector-name {
    overflow: hidden;
    min-width: 0;
    flex: 1 1 auto;
    text-overflow: ellipsis;
    font-weight: 520;
  }

  .model-identity,
  .provider-id {
    overflow: hidden;
    min-width: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
    direction: ltr;
    unicode-bidi: isolate;
    color: var(--v2-text-text-muted);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 10px;
    font-weight: 450;
    letter-spacing: 0;
    text-transform: none;
  }

  .selector-label .model-identity {
    flex: 0 1 45%;
  }

  .selector-affordances {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 6px;
    color: var(--v2-text-text-muted);
  }

  .selector-check {
    color: var(--v2-text-text-base);
    font-size: 11px;
  }

  .selector-chevron {
    font-size: 13px;
    line-height: 1;
  }

  .model-popover {
    position: absolute;
    z-index: 20;
    top: calc(100% + 6px);
    left: 0;
    width: 100%;
    box-sizing: border-box;
    overflow: hidden;
    border: 1px solid var(--v2-border-border-base);
    border-radius: 7px;
    background: var(--v2-background-bg-layer-01);
    box-shadow: 0 12px 32px color-mix(in oklch, var(--v2-background-bg-base), transparent 22%);
  }

  .model-popover.open-above {
    top: auto;
    bottom: calc(100% + 6px);
  }

  .search-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 8px;
    border-bottom: 0.5px solid var(--v2-border-border-muted);
    background: var(--v2-background-bg-base);
  }

  .search-icon {
    color: var(--v2-text-text-muted);
    font-size: 12px;
  }

  .search-row input {
    min-width: 0;
    flex: 1;
    border: 0;
    padding: 0;
    outline: 0;
    background: transparent;
    color: var(--v2-text-text-base);
    font: inherit;
    font-size: 12px;
  }

  .search-row input::placeholder {
    color: var(--v2-text-text-muted);
  }

  .model-options {
    max-height: 290px;
    overflow-y: auto;
    padding: 5px;
  }

  .provider-heading {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 7px;
    padding: 7px 7px 4px;
    color: var(--v2-text-text-muted);
    font-size: 10px;
    font-weight: 620;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .provider-heading .provider-id {
    flex: 0 1 auto;
  }

  .model-option {
    display: flex;
    width: 100%;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    border: 0;
    border-radius: 5px;
    padding: 6px 7px;
    background: transparent;
    color: var(--v2-text-text-base);
    font: inherit;
    font-size: 12px;
    font-weight: 540;
    line-height: 1.2;
    text-align: left;
    cursor: pointer;
  }

  .model-option-label {
    overflow: hidden;
    min-width: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .model-option-copy {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-width: 0;
    flex: 1 1 auto;
    align-items: stretch;
    gap: 2px;
  }

  .model-option-copy .model-option-label {
    flex: 1 1 auto;
  }

  .model-option-copy .model-identity {
    overflow: visible;
    flex: 0 0 auto;
    width: 100%;
    text-overflow: clip;
    white-space: normal;
    overflow-wrap: anywhere;
  }

  .model-option:hover,
  .model-option:focus-visible,
  .model-option.active,
  .model-option.selected {
    outline: 0;
    background: var(--v2-background-bg-layer-03);
  }

  .selected-check {
    color: var(--v2-text-text-base);
    font-size: 11px;
  }

  .empty-options {
    padding: 14px 8px;
    color: var(--v2-text-text-muted);
    font-size: 12px;
  }
</style>
