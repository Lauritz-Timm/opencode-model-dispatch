// Keep this value in sync with MAX_PICKER_RPC_LINE_BYTES in src-tauri/src/main.rs.
// The native boundary enforces it before emitting an event; this second check
// ensures alternate/test adapters cannot hand an oversized line to JSON.parse.
export const MAX_PICKER_RPC_LINE_BYTES = 4 * 1024 * 1024

export const MAX_PICKER_TASKS = 512
// These catalog limits intentionally match the producer-side bounds in
// src/model-catalog.ts. The picker rejects a contract violation rather than
// silently presenting a partial catalog.
export const MAX_PICKER_PROVIDERS_PER_CATALOG = 64
export const MAX_PICKER_MODELS_PER_PROVIDER = 512
export const MAX_PICKER_MODELS_PER_CATALOG = 1_024
export const MAX_PICKER_VARIANTS_PER_MODEL = 16

export const MAX_PICKER_ID_LENGTH = 256
export const MAX_PICKER_NAME_LENGTH = 256
export const MAX_PICKER_DESCRIPTION_LENGTH = 8_192
export const MAX_PICKER_VARIANT_LENGTH = 256

export function hasUtf8ByteLengthAtMost(value: string, maximum: number): boolean {
  let bytes = 0

  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit <= 0x7f) {
      bytes += 1
    } else if (codeUnit <= 0x7ff) {
      bytes += 2
    } else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        index += 1
      } else {
        bytes += 3
      }
    } else {
      bytes += 3
    }

    if (bytes > maximum) return false
  }

  return true
}
