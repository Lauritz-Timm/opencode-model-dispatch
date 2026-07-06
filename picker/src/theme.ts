export type ThemeName = "dark" | "light"

export const themeTokens = {
  dark: {
    background: "#0b0f14",
    surface: "#111820",
    text: "#d8dee9",
    muted: "#8b949e",
    accent: "#7aa2f7",
    danger: "#f7768e",
  },
  light: {
    background: "#f7f8fa",
    surface: "#ffffff",
    text: "#1f2328",
    muted: "#6e7781",
    accent: "#0969da",
    danger: "#cf222e",
  },
} as const

export function resolveTheme(preferred?: string): ThemeName {
  if (preferred === "light" || preferred === "dark") return preferred
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: light)").matches) return "light"
  return "dark"
}
