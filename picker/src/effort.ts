export function normalizeEffortVariants(variants: readonly string[]): string[] {
  return [...new Set(variants.filter((variant) => variant.length > 0))]
}

export function formatEffortVariantLabel(variant: string): string {
  const words = variant
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()

  if (!words) return variant
  return words
    .split(/\s+/)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`)
    .join(" ")
}
