<script lang="ts">
  import CompactSelect from "./CompactSelect.svelte"
  import { formatEffortVariantLabel, normalizeEffortVariants } from "./effort"

  export let value = ""
  export let variants: string[] = []
  export let ariaLabel = "Model effort"
  export let onChange: (value: string) => void = () => {}

  $: options = normalizeEffortVariants(variants)
  $: choices = [
    { value: "", label: "Auto" },
    ...options.map((variant) => ({
      value: variant,
      label: formatEffortVariantLabel(variant),
    })),
  ]
  $: if (value && !options.includes(value)) value = ""
  $: disabled = options.length === 0

  function selectEffort(nextValue: string) {
    value = nextValue
    onChange(nextValue)
  }
</script>

<div class="effort-select">
  <span class="effort-label">Effort</span>
  <div class="effort-control">
    <CompactSelect
      {value}
      options={choices}
      {ariaLabel}
      {disabled}
      onChange={selectEffort}
    />
  </div>
</div>

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

  .effort-control {
    min-width: 0;
    flex: 1 1 auto;
  }
</style>
