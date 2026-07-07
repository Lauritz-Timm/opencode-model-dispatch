<script lang="ts">
  import { tick } from "svelte"
  import type { PickerModel } from "./model-selection-reducer"

  export let value = ""
  export let groups: Array<{ providerID: string; providerName: string; models: PickerModel[] }> = []
  export let ariaLabel = "Model"
  export let onChange: (value: string) => void = () => {}

  let open = false
  let search = ""
  let root: HTMLDivElement
  let searchInput: HTMLInputElement

  $: selectedModel = groups.flatMap((group) => group.models).find((model) => modelValue(model) === value)
  $: selectedLabel = selectedModel ? selectedModel.displayName : "Select model"
  $: filteredGroups = filterGroups(groups, search)
  $: filteredModels = filteredGroups.flatMap((group) => group.models)

  function modelValue(model: PickerModel): string {
    return `${model.providerID}/${model.modelID}`
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
    open = true
    search = ""
    await tick()
    searchInput?.focus()
  }

  function closeDropdown() {
    open = false
    search = ""
  }

  function selectModel(nextValue: string) {
    value = nextValue
    onChange(nextValue)
    closeDropdown()
  }

  function handleDocumentPointerDown(event: PointerEvent) {
    if (!open || root?.contains(event.target as Node)) return
    closeDropdown()
  }

  function handleKeydown(event: KeyboardEvent) {
    if (!open) return

    if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      closeDropdown()
      return
    }

    if (event.key === "Enter" && filteredModels.length > 0) {
      event.preventDefault()
      event.stopPropagation()
      selectModel(modelValue(filteredModels[0]!))
    }
  }
</script>

<svelte:document on:pointerdown={handleDocumentPointerDown} />

<div bind:this={root} class="model-select">
  <button type="button" class="selector-button" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} on:click={open ? closeDropdown : openDropdown}>
    <span class="selector-label">{selectedLabel}</span>
    <span class="selector-affordances" aria-hidden="true">
      {#if selectedModel}<span class="selector-check">✓</span>{/if}
      <span class="selector-chevron">⌄</span>
    </span>
  </button>

  {#if open}
    <div class="model-popover" role="listbox" aria-label={ariaLabel} tabindex="-1" on:keydown={handleKeydown}>
      <div class="search-row">
        <span class="search-icon" aria-hidden="true">⌕</span>
        <input bind:this={searchInput} bind:value={search} type="search" placeholder="Search models" aria-label="Search models" />
        <span class="popover-glyphs" aria-hidden="true">
          <span>+</span>
          <span>⚙</span>
        </span>
      </div>

      <div class="model-options">
        {#each filteredGroups as group}
          <div class="provider-heading">{group.providerName}</div>
          {#each group.models as model}
            {@const optionValue = modelValue(model)}
            <button type="button" class="model-option" class:selected={optionValue === value} role="option" aria-selected={optionValue === value} on:click={() => selectModel(optionValue)}>
              <span>{model.displayName}</span>
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
    width: 220px;
    max-width: 100%;
  }

  .selector-button {
    display: inline-flex;
    width: 100%;
    min-height: 30px;
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
    outline: 1.5px solid var(--v2-border-border-active, var(--opencode-accent));
    outline-offset: 1px;
  }

  .selector-label {
    overflow: hidden;
    min-width: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 520;
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
    right: 0;
    width: min(320px, calc(100vw - 28px));
    overflow: hidden;
    border: 1px solid var(--v2-border-border-base);
    border-radius: 7px;
    background: var(--v2-background-bg-layer-01);
    box-shadow: 0 12px 32px color-mix(in oklch, var(--opencode-bg), transparent 22%);
  }

  .search-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 8px;
    border-bottom: 0.5px solid var(--v2-border-border-muted);
    background: var(--v2-background-bg-base);
  }

  .search-icon,
  .popover-glyphs {
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

  .popover-glyphs {
    display: inline-flex;
    gap: 8px;
  }

  .model-options {
    max-height: 290px;
    overflow-y: auto;
    padding: 5px;
  }

  .provider-heading {
    padding: 7px 7px 4px;
    color: var(--v2-text-text-muted);
    font-size: 10px;
    font-weight: 620;
    letter-spacing: 0.04em;
    text-transform: uppercase;
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

  .model-option:hover,
  .model-option:focus-visible,
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

  @media (max-width: 720px) {
    .model-select {
      width: 100%;
    }

    .model-popover {
      right: auto;
      left: 0;
      width: min(320px, 100%);
    }
  }
</style>
