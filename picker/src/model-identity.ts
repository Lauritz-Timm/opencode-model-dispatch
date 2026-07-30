import type { PickerModel } from "./model-selection-reducer"

type ModelIdentity = Pick<
  PickerModel,
  "providerID" | "modelID" | "displayName"
>

export function escapeModelIdentifier(value: string): string {
  let escaped = ""
  for (const symbol of value) {
    const codePoint = symbol.codePointAt(0)!
    if (codePoint >= 0x21 && codePoint <= 0x7e && symbol !== "\\") {
      escaped += symbol
    } else if (symbol === "\\") {
      escaped += "\\\\"
    } else {
      escaped += `\\u{${codePoint.toString(16).toUpperCase()}}`
    }
  }
  return escaped
}

export function formatModelIdentity(
  model: Pick<ModelIdentity, "providerID" | "modelID">,
): string {
  return (
    `${escapeModelIdentifier(model.providerID)}`
    + ` · ${escapeModelIdentifier(model.modelID)}`
  )
}

export function formatModelAccessibleLabel(model: ModelIdentity): string {
  return (
    `${model.displayName}, `
    + `provider ID ${escapeModelIdentifier(model.providerID)}, `
    + `model ID ${escapeModelIdentifier(model.modelID)}`
  )
}
