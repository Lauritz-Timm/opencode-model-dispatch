<script lang="ts">
  import { formatEffortVariantLabel, normalizeEffortVariants } from "./effort"

  export let value = ""
  export let variants: string[] = []
  export let ariaLabel = "Model effort"
  export let onChange: (value: string) => void = () => {}

  $: options = normalizeEffortVariants(variants)
  $: if (value && !options.includes(value)) value = ""

  function handleChange() {
    onChange(value)
  }
</script>

<label class="effort-select">
  <span class="effort-label">Effort</span>
  <span class="select-shell" class:disabled={options.length === 0}>
    <select bind:value disabled={options.length === 0} aria-label={ariaLabel} on:change={handleChange}>
      <option value="">Auto</option>
      {#each options as variant}
        <option value={variant}>{formatEffortVariantLabel(variant)}</option>
      {/each}
    </select>
    <span class="select-chevron" aria-hidden="true"></span>
  </span>
</label>

<style>
  .effort-select {
    display: flex;
    width: 100%;
    min-width: 0;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
    color: var(--v2-text-text-muted);
    font-size: 10.5px;
  }

  .effort-label {
    flex: 0 0 auto;
  }

  .select-shell {
    position: relative;
    height: 30px;
    min-width: 0;
    box-sizing: border-box;
    flex: 1 1 auto;
    overflow: hidden;
    border: 0.5px solid var(--v2-border-border-muted);
    border-radius: 6px;
    background-color: var(--v2-background-bg-base);
    box-shadow: var(--v2-elevation-elements);
    transition: background-color 120ms ease-out, border-color 120ms ease-out, box-shadow 120ms ease-out;
  }

  .select-shell:hover:not(.disabled) {
    border-color: var(--v2-border-border-base);
    background-color: var(--v2-background-bg-layer-01);
  }

  .select-shell:focus-within {
    border-color: var(--v2-border-border-focus);
    box-shadow: 0 0 0 1px var(--v2-border-border-focus);
  }

  select {
    width: 100%;
    min-width: 0;
    height: 100%;
    border: 0;
    border-radius: inherit;
    padding: 0 24px 0 8px;
    -webkit-appearance: none;
    appearance: none;
    color-scheme: inherit;
    outline: 0;
    background-color: transparent;
    background-image: none;
    color: var(--v2-text-text-base);
    -webkit-text-fill-color: var(--v2-text-text-base);
    font: inherit;
    font-size: 10.5px;
    line-height: 28px;
    cursor: pointer;
  }

  option {
    background-color: var(--v2-background-bg-layer-01);
    color: var(--v2-text-text-base);
  }

  .select-chevron {
    position: absolute;
    top: 50%;
    right: 9px;
    width: 5px;
    height: 5px;
    border-right: 1px solid var(--v2-text-text-muted);
    border-bottom: 1px solid var(--v2-text-text-muted);
    transform: translateY(-70%) rotate(45deg);
    pointer-events: none;
  }

  .select-shell.disabled {
    background-color: var(--v2-background-bg-layer-01);
    box-shadow: none;
    opacity: 0.5;
  }

  select:disabled {
    cursor: not-allowed;
    color: var(--v2-text-text-muted);
    -webkit-text-fill-color: var(--v2-text-text-muted);
  }
</style>
