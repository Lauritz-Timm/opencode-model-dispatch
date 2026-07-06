<script lang="ts">
  export let label: string
  export let description: string
  export let value: number
  export let suffix = ""
  export let onChange: (value: number) => void = () => {}

  let inputValue = String(value)
  $: if (String(value) !== inputValue && isValidNumberInput(String(value))) inputValue = String(value)

  function isValidNumberInput(raw: string): boolean {
    if (!/^\d+$/.test(raw)) return false
    return Number(raw) >= 1
  }

  function handleInput(raw: string) {
    inputValue = raw
    if (isValidNumberInput(raw)) onChange(Number(raw))
  }
</script>

<label data-component="settings-v2-row">
  <span data-slot="settings-v2-row-copy">
    <strong data-slot="settings-v2-row-title">{label}</strong>
    <small data-slot="settings-v2-row-description">{description}</small>
  </span>
  <span data-slot="settings-v2-row-control" class="field">
    <input
      type="text"
      inputmode="numeric"
      pattern="[0-9]*"
      value={inputValue}
      aria-invalid={!isValidNumberInput(inputValue)}
      on:input={(event) => handleInput(event.currentTarget.value)}
    />
    {#if suffix}<small>{suffix}</small>{/if}
  </span>
</label>

<style>
  [data-component="settings-v2-row"] {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 16px;
    padding-block: 20px;
    border-bottom: 0.5px solid var(--v2-border-border-base);
    color: var(--v2-text-text-base);
  }

  [data-component="settings-v2-row"]:last-child {
    border-bottom: none;
  }

  [data-slot="settings-v2-row-copy"] {
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
    gap: 8px;
  }

  [data-slot="settings-v2-row-title"] {
    font-style: normal;
    font-size: 13px;
    font-weight: 530;
    line-height: 1;
    letter-spacing: -0.04px;
    color: var(--v2-text-text-base);
    font-variation-settings: "slnt" 0;
  }

  [data-slot="settings-v2-row-description"] {
    font-size: 11px;
    font-weight: 440;
    line-height: 1;
    color: var(--v2-text-text-muted);
  }

  [data-slot="settings-v2-row-control"] {
    display: flex;
    width: 100%;
    justify-content: flex-end;
  }

  .field {
    width: 168px;
    align-items: center;
    gap: 8px;
  }

  @media (min-width: 640px) {
    [data-component="settings-v2-row"] {
      flex-wrap: nowrap;
    }

    [data-slot="settings-v2-row-control"] {
      width: auto;
      flex-shrink: 0;
    }
  }

  input {
    width: 100%;
    box-sizing: border-box;
    border: 0.5px solid var(--v2-border-border-muted);
    border-radius: 8px;
    padding: 9px 10px;
    background: var(--v2-background-bg-base);
    color: var(--v2-text-text-base);
    font: inherit;
    font-size: 12px;
    font-weight: 440;
  }

  input:focus {
    outline: 2px solid color-mix(in oklch, var(--v2-text-text-accent), transparent 35%);
    outline-offset: 1px;
  }

  input[aria-invalid="true"] {
    border-color: var(--v2-state-border-danger, var(--v2-text-text-danger));
  }
</style>
