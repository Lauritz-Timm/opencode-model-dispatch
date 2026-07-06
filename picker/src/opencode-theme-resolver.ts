import { resolveThemeVariant, themeToCss } from "./opencode-themes/resolve"
import { resolveThemeVariantV2, themeV2ToCss } from "./opencode-themes/v2/resolve"
import type { DesktopTheme } from "./opencode-themes/types"
import amoled from "./opencode-themes/themes/amoled.json"
import aura from "./opencode-themes/themes/aura.json"
import ayu from "./opencode-themes/themes/ayu.json"
import carbonfox from "./opencode-themes/themes/carbonfox.json"
import catppuccin from "./opencode-themes/themes/catppuccin.json"
import catppuccinFrappe from "./opencode-themes/themes/catppuccin-frappe.json"
import catppuccinMacchiato from "./opencode-themes/themes/catppuccin-macchiato.json"
import cobalt2 from "./opencode-themes/themes/cobalt2.json"
import cursor from "./opencode-themes/themes/cursor.json"
import dracula from "./opencode-themes/themes/dracula.json"
import everforest from "./opencode-themes/themes/everforest.json"
import flexoki from "./opencode-themes/themes/flexoki.json"
import github from "./opencode-themes/themes/github.json"
import gruvbox from "./opencode-themes/themes/gruvbox.json"
import kanagawa from "./opencode-themes/themes/kanagawa.json"
import lucentOrng from "./opencode-themes/themes/lucent-orng.json"
import material from "./opencode-themes/themes/material.json"
import matrix from "./opencode-themes/themes/matrix.json"
import mercury from "./opencode-themes/themes/mercury.json"
import monokai from "./opencode-themes/themes/monokai.json"
import nightowl from "./opencode-themes/themes/nightowl.json"
import nord from "./opencode-themes/themes/nord.json"
import oc2 from "./opencode-themes/themes/oc-2.json"
import oneDark from "./opencode-themes/themes/one-dark.json"
import onedarkpro from "./opencode-themes/themes/onedarkpro.json"
import opencode from "./opencode-themes/themes/opencode.json"
import orng from "./opencode-themes/themes/orng.json"
import osakaJade from "./opencode-themes/themes/osaka-jade.json"
import palenight from "./opencode-themes/themes/palenight.json"
import rosepine from "./opencode-themes/themes/rosepine.json"
import shadesofpurple from "./opencode-themes/themes/shadesofpurple.json"
import solarized from "./opencode-themes/themes/solarized.json"
import synthwave84 from "./opencode-themes/themes/synthwave84.json"
import tokyonight from "./opencode-themes/themes/tokyonight.json"
import vercel from "./opencode-themes/themes/vercel.json"
import vesper from "./opencode-themes/themes/vesper.json"
import zenburn from "./opencode-themes/themes/zenburn.json"

export type OpenCodeColorScheme = "light" | "dark" | "system"

export interface ResolveOpenCodeThemeOptions {
  themeID?: string
  colorScheme?: string
}

export interface ResolvedOpenCodeThemeCss {
  themeID: string
  mode: "light" | "dark"
  cssText: string
  cssVariables: Record<string, string>
}

const themes: Record<string, DesktopTheme> = {
  amoled,
  aura,
  ayu,
  carbonfox,
  catppuccin,
  "catppuccin-frappe": catppuccinFrappe,
  "catppuccin-macchiato": catppuccinMacchiato,
  cobalt2,
  cursor,
  dracula,
  everforest,
  flexoki,
  github,
  gruvbox,
  kanagawa,
  "lucent-orng": lucentOrng,
  material,
  matrix,
  mercury,
  monokai,
  nightowl,
  nord,
  "oc-2": oc2,
  "one-dark": oneDark,
  onedarkpro,
  opencode,
  orng,
  "osaka-jade": osakaJade,
  palenight,
  rosepine,
  shadesofpurple,
  solarized,
  synthwave84,
  tokyonight,
  vercel,
  vesper,
  zenburn,
} as Record<string, DesktopTheme>

export function resolveOpenCodeThemeCss(options: ResolveOpenCodeThemeOptions = {}): ResolvedOpenCodeThemeCss {
  const themeID = normalizeThemeID(options.themeID)
  const mode = normalizeMode(options.colorScheme)
  const theme = themes[themeID] ?? themes["oc-2"]!
  const variant = mode === "dark" ? theme.dark : theme.light
  const cssText = `${themeToCss(resolveThemeVariant(variant, mode === "dark"))}\n  ${themeV2ToCss(resolveThemeVariantV2(variant, mode === "dark"))}`

  return { themeID, mode, cssText, cssVariables: parseCssVariables(cssText) }
}

function normalizeThemeID(themeID: string | undefined): string {
  if (themeID === "oc-1") return "oc-2"
  if (themeID && themes[themeID]) return themeID
  return "oc-2"
}

function normalizeMode(colorScheme: string | undefined): "light" | "dark" {
  if (colorScheme === "light" || colorScheme === "dark") return colorScheme
  return "dark"
}

function parseCssVariables(cssText: string): Record<string, string> {
  const variables: Record<string, string> = {}
  for (const part of cssText.split(";")) {
    const separator = part.indexOf(":")
    if (separator === -1) continue
    const name = part.slice(0, separator).trim()
    const value = part.slice(separator + 1).trim()
    if (name.startsWith("--") && value) variables[name.slice(2)] = value
  }
  return variables
}
