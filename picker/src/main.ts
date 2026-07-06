import { createModelSelectionState, filteredModelGroups } from "./model-selection-reducer"
import { createSetupState } from "./setup-reducer"
import { resolveTheme, themeTokens } from "./theme"

const app = document.querySelector<HTMLDivElement>("#app")
const theme = themeTokens[resolveTheme()]

document.documentElement.style.colorScheme = resolveTheme()
document.body.style.margin = "0"
document.body.style.background = theme.background
document.body.style.color = theme.text
document.body.style.fontFamily = "ui-sans-serif, system-ui, sans-serif"

if (app) {
  const modelState = createModelSelectionState({ tasks: [], models: [] })
  const setupState = createSetupState()
  app.innerHTML = `
    <section style="padding: 16px; background: ${theme.surface}; min-height: 100vh; box-sizing: border-box;">
      <h1 style="margin: 0 0 8px; font-size: 18px;">Model Dispatch Picker Skeleton</h1>
      <p style="margin: 0 0 16px; color: ${theme.muted};">Reducers and JSON-RPC contracts are the supported surface in this slice.</p>
      <pre style="white-space: pre-wrap; font-size: 12px;">${JSON.stringify({ mode: "model-selection", rows: modelState.rowOrder, groups: filteredModelGroups(modelState) }, null, 2)}</pre>
      <pre style="white-space: pre-wrap; font-size: 12px;">${JSON.stringify({ mode: "setup", settings: setupState.settings, scope: setupState.scope }, null, 2)}</pre>
    </section>
  `
}
