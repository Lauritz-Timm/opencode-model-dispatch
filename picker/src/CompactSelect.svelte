<script context="module" lang="ts">
  export interface CompactSelectOption {
    value: string
    label: string
  }

  let compactSelectSequence = 0
</script>

<script lang="ts">
  import { onDestroy, tick } from "svelte"

  export let value = ""
  export let options: CompactSelectOption[] = []
  export let ariaLabel = "Select option"
  export let disabled = false
  export let onChange: (value: string) => void = () => {}

  const instanceID = `compact-select-${compactSelectSequence++}`
  const listboxID = `${instanceID}-listbox`
  const typeaheadResetMs = 700
  const popoverGap = 6
  const viewportPadding = 8
  const clippingInset = 4
  let open = false
  let openAbove = false
  let activeIndex = 0
  let popoverMaxHeight = 240
  let typeaheadPrefix = ""
  let typeaheadTimer: ReturnType<typeof setTimeout> | undefined
  let root: HTMLDivElement
  let triggerButton: HTMLButtonElement

  $: selectedOptionIndex = options.findIndex((option) => option.value === value)
  $: selectedIndex = selectedOptionIndex >= 0 ? selectedOptionIndex : 0
  $: selectedLabel = options[selectedIndex]?.label ?? ""
  $: isDisabled = disabled || options.length === 0
  $: if (activeIndex >= options.length) activeIndex = Math.max(0, options.length - 1)
  $: if (isDisabled && open) closeDropdown()

  onDestroy(clearTypeahead)

  async function openDropdown(nextIndex = selectedIndex) {
    if (isDisabled) return
    updatePopoverGeometry()
    activeIndex = Math.min(Math.max(nextIndex, 0), options.length - 1)
    open = true
    await tick()
    focusActiveOption()
  }

  function updatePopoverGeometry() {
    const bounds = root?.getBoundingClientRect()
    if (!bounds) return
    const clippingRange = visibleVerticalRange(root)
    const estimatedHeight = options.length * 29 + 10
    const spaceBelow = Math.max(
      0,
      clippingRange.bottom - bounds.bottom - popoverGap,
    )
    const spaceAbove = Math.max(
      0,
      bounds.top - clippingRange.top - popoverGap,
    )
    openAbove = spaceBelow < estimatedHeight && spaceAbove > spaceBelow
    const availableSpace = openAbove ? spaceAbove : spaceBelow
    popoverMaxHeight = Math.min(estimatedHeight, availableSpace)
  }

  function visibleVerticalRange(element: HTMLElement): {
    top: number
    bottom: number
  } {
    let top = viewportPadding
    let bottom = window.innerHeight - viewportPadding
    let ancestor = element.parentElement

    while (ancestor) {
      const overflowY = window.getComputedStyle(ancestor).overflowY
      if (
        overflowY === "auto"
        || overflowY === "scroll"
        || overflowY === "hidden"
        || overflowY === "clip"
      ) {
        const bounds = ancestor.getBoundingClientRect()
        top = Math.max(top, bounds.top + clippingInset)
        bottom = Math.min(bottom, bounds.bottom - clippingInset)
      }
      ancestor = ancestor.parentElement
    }

    return { top, bottom }
  }

  function handleGeometryChange() {
    if (open) updatePopoverGeometry()
  }

  function closeDropdown(restoreTriggerFocus = false) {
    open = false
    clearTypeahead()
    if (restoreTriggerFocus) void tick().then(() => triggerButton?.focus())
  }

  function focusActiveOption() {
    const option = root
      ?.querySelector<HTMLButtonElement>(`[data-compact-option-index="${activeIndex}"]`)
    option?.focus({ preventScroll: true })
    option?.scrollIntoView({ block: "nearest" })
  }

  function moveActive(nextIndex: number) {
    activeIndex = (nextIndex + options.length) % options.length
    void tick().then(focusActiveOption)
  }

  function handleTriggerClick() {
    if (open) closeDropdown()
    else void openDropdown()
  }

  function selectOption(nextValue: string) {
    value = nextValue
    onChange(nextValue)
    closeDropdown(true)
  }

  function handleDocumentPointerDown(event: PointerEvent) {
    if (!open || root?.contains(event.target as Node)) return
    closeDropdown()
  }

  function handleKeydown(event: KeyboardEvent) {
    if (isDisabled) return

    if (isPrintableTypeaheadKey(event)) {
      event.preventDefault()
      event.stopPropagation()
      handleTypeahead(event.key)
      return
    }

    if (!open) {
      if (
        event.key === "ArrowDown"
        || event.key === "ArrowUp"
        || event.key === "Home"
        || event.key === "End"
        || event.key === "Enter"
        || event.key === " "
      ) {
        event.preventDefault()
        event.stopPropagation()
        const nextIndex =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? options.length - 1
              : selectedIndex
        void openDropdown(nextIndex)
      }
      return
    }

    if (event.key === "Tab") {
      closeDropdown()
      return
    }

    if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      closeDropdown(true)
      return
    }

    if (
      event.key === "ArrowDown"
      || event.key === "ArrowUp"
      || event.key === "Home"
      || event.key === "End"
    ) {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === "Home") moveActive(0)
      else if (event.key === "End") moveActive(options.length - 1)
      else moveActive(activeIndex + (event.key === "ArrowDown" ? 1 : -1))
      return
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      event.stopPropagation()
      const option = options[activeIndex]
      if (option) selectOption(option.value)
    }
  }

  function handleTypeahead(key: string) {
    const character = key.toLocaleLowerCase()
    let nextPrefix = `${typeaheadPrefix}${character}`
    const startIndex = typeaheadPrefix ? 0 : activeIndex + 1
    let matchIndex = findOptionByPrefix(nextPrefix, startIndex)

    if (matchIndex < 0 && typeaheadPrefix) {
      nextPrefix = character
      matchIndex = findOptionByPrefix(nextPrefix, activeIndex + 1)
    }

    typeaheadPrefix = nextPrefix
    scheduleTypeaheadReset()
    if (matchIndex < 0) return
    if (open) moveActive(matchIndex)
    else void openDropdown(matchIndex)
  }

  function findOptionByPrefix(prefix: string, startIndex: number): number {
    for (let offset = 0; offset < options.length; offset += 1) {
      const index = (startIndex + offset) % options.length
      if (options[index]?.label.trim().toLocaleLowerCase().startsWith(prefix)) {
        return index
      }
    }
    return -1
  }

  function scheduleTypeaheadReset() {
    if (typeaheadTimer) clearTimeout(typeaheadTimer)
    typeaheadTimer = setTimeout(() => {
      typeaheadPrefix = ""
      typeaheadTimer = undefined
    }, typeaheadResetMs)
  }

  function clearTypeahead() {
    typeaheadPrefix = ""
    if (!typeaheadTimer) return
    clearTimeout(typeaheadTimer)
    typeaheadTimer = undefined
  }

  function isPrintableTypeaheadKey(event: KeyboardEvent): boolean {
    return event.key.length === 1
      && event.key !== " "
      && !event.altKey
      && !event.ctrlKey
      && !event.metaKey
  }
</script>

<svelte:window on:resize={handleGeometryChange} />
<svelte:document
  on:pointerdown={handleDocumentPointerDown}
  on:scroll|capture={handleGeometryChange}
/>

<div bind:this={root} class="compact-select" class:disabled={isDisabled}>
  <button
    bind:this={triggerButton}
    type="button"
    class="compact-trigger"
    disabled={isDisabled}
    aria-label={`${ariaLabel}: ${selectedLabel}`}
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-controls={listboxID}
    on:click={handleTriggerClick}
    on:keydown={handleKeydown}
  >
    <span class="compact-value">{selectedLabel}</span>
    <span class="select-chevron" aria-hidden="true"></span>
  </button>

  {#if open}
    <div
      id={listboxID}
      class="compact-popover"
      class:open-above={openAbove}
      role="listbox"
      aria-label={ariaLabel}
      style={`max-height: ${popoverMaxHeight}px`}
    >
      {#each options as option, optionIndex}
        <button
          id={`${listboxID}-option-${optionIndex}`}
          data-compact-option-index={optionIndex}
          type="button"
          tabindex="-1"
          class="compact-option"
          class:active={optionIndex === activeIndex}
          class:selected={option.value === value}
          role="option"
          aria-selected={option.value === value}
          on:focus={() => (activeIndex = optionIndex)}
          on:mouseenter={() => (activeIndex = optionIndex)}
          on:keydown={handleKeydown}
          on:click={() => selectOption(option.value)}
        >
          <span>{option.label}</span>
          {#if option.value === value}
            <span class="selected-check" aria-hidden="true">✓</span>
          {/if}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .compact-select {
    position: relative;
    width: 100%;
    height: 30px;
    min-width: 0;
    box-sizing: border-box;
    border: 0.5px solid var(--v2-border-border-muted);
    border-radius: 6px;
    background-color: var(--v2-background-bg-base);
    box-shadow: var(--v2-elevation-elements);
    color: var(--v2-text-text-muted);
    font-size: 10.5px;
    transition: background-color 120ms ease-out, border-color 120ms ease-out, box-shadow 120ms ease-out;
  }

  .compact-select:hover:not(.disabled),
  .compact-select:has(.compact-trigger[aria-expanded="true"]) {
    border-color: var(--v2-border-border-base);
    background-color: var(--v2-background-bg-layer-01);
  }

  .compact-select:focus-within {
    border-color: var(--v2-border-border-focus);
    box-shadow: 0 0 0 1px var(--v2-border-border-focus);
  }

  .compact-trigger {
    display: flex;
    width: 100%;
    height: 100%;
    min-width: 0;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    border: 0;
    border-radius: inherit;
    padding: 0 8px;
    outline: 0;
    background: transparent;
    color: var(--v2-text-text-base);
    font: inherit;
    font-size: 10.5px;
    line-height: 28px;
    text-align: left;
    cursor: pointer;
  }

  .compact-value {
    overflow: hidden;
    min-width: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .select-chevron {
    width: 5px;
    height: 5px;
    flex: 0 0 auto;
    margin: 0 2px 3px 0;
    border-right: 1px solid var(--v2-text-text-muted);
    border-bottom: 1px solid var(--v2-text-text-muted);
    transform: rotate(45deg);
  }

  .compact-popover {
    position: absolute;
    z-index: 30;
    top: calc(100% + 6px);
    left: -0.5px;
    width: calc(100% + 1px);
    box-sizing: border-box;
    padding: 4px;
    overflow-x: hidden;
    overflow-y: auto;
    border: 1px solid var(--v2-border-border-base);
    border-radius: 7px;
    background: var(--v2-background-bg-layer-01);
    box-shadow: 0 12px 32px color-mix(in oklch, var(--v2-background-bg-base), transparent 22%);
    scrollbar-color: var(--v2-border-border-base) transparent;
    scrollbar-width: thin;
  }

  .compact-popover.open-above {
    top: auto;
    bottom: calc(100% + 6px);
  }

  .compact-option {
    display: flex;
    width: 100%;
    min-height: 27px;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    border: 0;
    border-radius: 5px;
    padding: 5px 7px;
    outline: 0;
    background: transparent;
    color: var(--v2-text-text-base);
    font: inherit;
    font-size: 10.5px;
    line-height: 1.2;
    text-align: left;
    cursor: pointer;
    scroll-margin-block: 4px;
  }

  .compact-option:hover,
  .compact-option:focus-visible,
  .compact-option.active,
  .compact-option.selected {
    background: var(--v2-background-bg-layer-03);
  }

  .selected-check {
    color: var(--v2-text-text-base);
    font-size: 10px;
  }

  .compact-select.disabled {
    background-color: var(--v2-background-bg-layer-01);
    box-shadow: none;
    opacity: 0.5;
  }

  .compact-trigger:disabled {
    color: var(--v2-text-text-muted);
    cursor: not-allowed;
  }
</style>
