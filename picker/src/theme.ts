import { resolveOpenCodeTheme, resolveOpenCodeV2ThemeVariables, roleToCssName } from "./opencode-theme"

export type ThemeName = "dark" | "light"

export type OpenCodeTokenName =
  | "opencode-bg"
  | "opencode-surface"
  | "opencode-text"
  | "opencode-muted"
  | "opencode-accent"
  | "opencode-danger"

export type OpenCodeThemeTokens = Record<OpenCodeTokenName, string>

export interface OpenCodeThemeBridge {
  mode?: ThemeName
  cssText?: string
  cssVariables?: Record<string, string>
}

function v2Token(mode: ThemeName, name: string): string {
  const value = resolveOpenCodeV2ThemeVariables(mode)[name]
  if (!value) throw new Error(`Missing OpenCode V2 theme token: ${name}`)
  return value
}

export const themeTokens: Record<ThemeName, OpenCodeThemeTokens> = {
  dark: {
    "opencode-bg": v2Token("dark", "v2-background-bg-base"),
    "opencode-surface": v2Token("dark", "v2-background-bg-layer-01"),
    "opencode-text": v2Token("dark", "v2-text-text-base"),
    "opencode-muted": v2Token("dark", "v2-text-text-muted"),
    "opencode-accent": v2Token("dark", "v2-text-text-accent"),
    "opencode-danger": v2Token("dark", "v2-text-text-danger"),
  },
  light: {
    "opencode-bg": v2Token("light", "v2-background-bg-base"),
    "opencode-surface": v2Token("light", "v2-background-bg-layer-01"),
    "opencode-text": v2Token("light", "v2-text-text-base"),
    "opencode-muted": v2Token("light", "v2-text-text-muted"),
    "opencode-accent": v2Token("light", "v2-text-text-accent"),
    "opencode-danger": v2Token("light", "v2-text-text-danger"),
  },
} as const

export function resolveTheme(preferred?: string): ThemeName {
  if (preferred === "light" || preferred === "dark") return preferred
  return "dark"
}

export function cssVariables(tokens: OpenCodeThemeTokens, bridge?: OpenCodeThemeBridge): string {
  const mode = bridge?.mode ?? (tokens["opencode-bg"] === themeTokens.light["opencode-bg"] ? "light" : "dark")
  const upstream = Object.entries(resolveOpenCodeTheme(mode)).map(([role, value]) => [`opencode-${roleToCssName(role)}`, value])
  const v2 = Object.entries(resolveOpenCodeV2ThemeVariables(mode))
  const aliases = Object.entries(tokens)
  const bridged = Object.entries({ ...parseCssVariables(bridge?.cssText), ...sanitizeCssVariables(bridge?.cssVariables) })
  return [...v2, ...upstream, ...aliases, ...bridged]
    .map(([name, value]) => `--${name}: ${value};`)
    .join(" ")
}

function parseCssVariables(cssText: string | undefined): Record<string, string> {
  if (!cssText) return {}
  const variables: Record<string, string> = {}
  for (const part of cssText.split(";")) {
    const separator = part.indexOf(":")
    if (separator === -1) continue
    const name = part.slice(0, separator).trim()
    const value = part.slice(separator + 1).trim()
    if (isCssVariable(name, value)) variables[name.slice(2)] = value
  }
  return variables
}

function sanitizeCssVariables(input: Record<string, string> | undefined): Record<string, string> {
  if (!input) return {}
  const variables: Record<string, string> = {}
  for (const [rawName, rawValue] of Object.entries(input)) {
    const name = rawName.startsWith("--") ? rawName : `--${rawName}`
    const value = rawValue.trim()
    if (isCssVariable(name, value)) variables[name.slice(2)] = value
  }
  return variables
}

function isCssVariable(name: string, value: string): boolean {
  return /^--[a-zA-Z0-9_-]+$/.test(name) && value.length > 0 && !/[;{}]/.test(value)
}
