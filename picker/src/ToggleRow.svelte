<script lang="ts">
  export let label: string
  export let description: string
  export let checked = false
  export let disabled = false
  export let onChange: (checked: boolean) => void = () => {}
</script>

<label data-component="settings-v2-row" class:disabled>
  <span data-slot="settings-v2-row-copy">
    <strong data-slot="settings-v2-row-title">{label}</strong>
    <small data-slot="settings-v2-row-description">{description}</small>
  </span>
  <span data-slot="settings-v2-row-control">
    <span data-component="switch" data-checked={checked ? "" : undefined} data-disabled={disabled ? "" : undefined}>
      <input data-slot="switch-input" type="checkbox" role="switch" {checked} {disabled} on:change={(event) => onChange(event.currentTarget.checked)} />
      <span data-slot="switch-control" aria-hidden="true">
        <span data-slot="switch-thumb"></span>
      </span>
    </span>
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

  [data-component="settings-v2-row"].disabled {
    opacity: 0.5;
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

  [data-slot="settings-v2-row-control"] > [data-component="switch"] {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    cursor: default;
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

  [data-slot="switch-input"] {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border-width: 0;
  }

  [data-slot="switch-control"] {
    box-sizing: border-box;
    display: inline-flex;
    justify-content: flex-start;
    align-items: center;
    padding: 2px;
    width: 24px;
    height: 16px;
    flex-shrink: 0;
    border-radius: 4px;
    border: none;
    background:
      linear-gradient(180deg, var(--v2-alpha-light-0) 0%, var(--v2-alpha-light-20) 100%),
      var(--v2-background-bg-layer-03);
    box-shadow: var(--v2-elevation-switch-off);
    transition: background 90ms ease-out, opacity 90ms ease-out, outline-color 90ms ease-out;
  }

  [data-slot="switch-thumb"] {
    box-sizing: border-box;
    width: 12px;
    height: 12px;
    transform: translateX(0);
    border-radius: 2px;
    border: 0.5px solid var(--v2-overlay-gradient-depth-overlay-depth-top);
    background:
      linear-gradient(
        180deg,
        var(--v2-overlay-gradient-depth-overlay-depth-top) 0%,
        var(--v2-overlay-gradient-depth-overlay-depth-bot) 100%
      ),
      var(--v2-grey-200);
    box-shadow: var(--v2-elevation-elements);
    transition: transform 90ms ease-out, width 90ms ease-out, border-radius 90ms, background 90ms;
  }

  [data-component="switch"]:hover:not([data-disabled]) [data-slot="switch-control"] {
    background:
      linear-gradient(0deg, var(--v2-overlay-simple-overlay-hover), var(--v2-overlay-simple-overlay-hover)),
      linear-gradient(180deg, var(--v2-alpha-light-0) 0%, var(--v2-alpha-light-20) 100%),
      var(--v2-background-bg-layer-03);
  }

  [data-component="switch"]:hover:not([data-disabled]) [data-slot="switch-thumb"] {
    width: 13px;
    border-radius: 3px;
  }

  [data-slot="switch-input"]:focus-visible ~ [data-slot="switch-control"] {
    outline: 2px solid var(--v2-border-border-focus);
    outline-offset: 1px;
  }

  [data-component="switch"][data-checked] [data-slot="switch-control"] {
    background:
      linear-gradient(180deg, var(--v2-alpha-light-0) 0%, var(--v2-alpha-light-10) 100%),
      var(--v2-background-bg-accent);
    box-shadow: var(--v2-elevation-switch-on);
  }

  [data-component="switch"][data-checked] [data-slot="switch-thumb"] {
    transform: translateX(8px);
    border-radius: 2px;
    background:
      linear-gradient(
        180deg,
        var(--v2-overlay-gradient-depth-overlay-depth-top) 0%,
        var(--v2-overlay-gradient-depth-overlay-depth-bot) 100%
      ),
      var(--v2-grey-300);
  }

  [data-component="switch"][data-checked]:hover:not([data-disabled]) [data-slot="switch-control"] {
    background:
      linear-gradient(0deg, var(--v2-overlay-simple-overlay-contrast-hover), var(--v2-overlay-simple-overlay-contrast-hover)),
      linear-gradient(180deg, var(--v2-alpha-light-0) 0%, var(--v2-alpha-light-10) 100%),
      var(--v2-background-bg-accent);
  }

  [data-component="switch"][data-checked]:hover:not([data-disabled]) [data-slot="switch-thumb"] {
    transform: translateX(7px);
  }

  [data-component="switch"][data-disabled] {
    cursor: not-allowed;
  }

  [data-component="switch"][data-disabled] [data-slot="switch-control"] {
    opacity: 0.5;
  }

  [data-slot="switch-input"]:disabled ~ [data-slot="switch-control"] {
    opacity: 0.5;
  }

  input {
    margin: 0;
  }
</style>
