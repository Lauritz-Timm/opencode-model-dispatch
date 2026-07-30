import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

import {
  DEFAULT_SETTINGS,
  MAX_SETTINGS_FILE_BYTES,
  readSettings,
  snoozeSetupFor24Hours,
  writeSettings,
} from "../src/settings"

const tempDirs: string[] = []

async function tempPath() {
  const dir = await mkdtemp(join(tmpdir(), "model-dispatch-settings-"))
  tempDirs.push(dir)
  return {
    dir,
    globalPath: join(dir, "global", "model-dispatch.json"),
    projectPath: join(dir, "project", ".opencode", "model-dispatch.json"),
  }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })))
})

describe("settings", () => {
  test("returns defaults when no settings files exist", async () => {
    const paths = await tempPath()

    const result = await readSettings(paths)

    expect(result.settings).toEqual(DEFAULT_SETTINGS)
    expect(result.warnings).toEqual([])
  })

  test("deep merges dispatch from global and project settings", async () => {
    const paths = await tempPath()
    await writeSettings(paths.globalPath, {
      dispatch: { enabled: true, batch_ms: 250, technical_failure: "default_model" },
    })
    await writeSettings(paths.projectPath, {
      dispatch: { picker_timeout_ms: 1000 },
    })

    const result = await readSettings(paths)

    expect(result.settings.dispatch).toEqual({
      enabled: true,
      batch_ms: 250,
      picker_timeout_ms: 1000,
      technical_failure: "default_model",
    })
  })

  test("ignores unsafe project-controlled timer values", async () => {
    const paths = await tempPath()
    await writeSettings(paths.globalPath, {
      dispatch: {
        batch_ms: 250,
        picker_timeout_ms: 1_000,
      },
    })
    await writeSettings(paths.projectPath, {
      dispatch: {
        batch_ms: -1,
        picker_timeout_ms: 1_000_000_000,
      },
    })

    const result = await readSettings(paths)

    expect(result.settings.dispatch.batch_ms).toBe(250)
    expect(result.settings.dispatch.picker_timeout_ms).toBe(1_000)
  })

  test("keeps privacy logging global-only", async () => {
    const paths = await tempPath()
    await writeSettings(paths.globalPath, { privacy: { logging_enabled: false } })
    await writeSettings(paths.projectPath, { privacy: { logging_enabled: true } })

    const result = await readSettings(paths)

    expect(result.settings.privacy.logging_enabled).toBe(false)
  })

  test("reads appearance theme settings globally", async () => {
    const paths = await tempPath()
    await mkdir(join(paths.dir, "global"), { recursive: true })
    await mkdir(join(paths.dir, "project", ".opencode"), { recursive: true })
    await writeFile(paths.globalPath, JSON.stringify({ appearance: { theme_id: "nightowl", color_scheme: "dark" } }), "utf8")
    await writeFile(paths.projectPath, JSON.stringify({ appearance: { theme_id: "material", color_scheme: "light" } }), "utf8")

    const result = await readSettings(paths)

    expect(result.settings.appearance).toEqual({ theme_id: "nightowl", color_scheme: "dark" })
  })

  test("supports setup snooze for 24 hours", () => {
    const now = new Date("2026-01-01T00:00:00.000Z")

    const settings = snoozeSetupFor24Hours(DEFAULT_SETTINGS, now)

    expect(settings.setup.snoozed_until).toBe(now.getTime() + 24 * 60 * 60 * 1000)
  })

  test("returns defaults plus warning for corrupt settings", async () => {
    const paths = await tempPath()
    await mkdir(join(paths.dir, "global"), { recursive: true })
    await writeFile(paths.globalPath, "{not-json", "utf8")

    const result = await readSettings(paths)

    expect(result.settings).toEqual(DEFAULT_SETTINGS)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain("model-dispatch.json")
  })

  test("rejects a project settings symlink before following it", async () => {
    if (process.platform === "win32") return
    const paths = await tempPath()
    const target = join(paths.dir, "outside-settings.json")
    await writeFile(
      target,
      JSON.stringify({ dispatch: { enabled: true } }),
      "utf8",
    )
    await mkdir(join(paths.dir, "project", ".opencode"), { recursive: true })
    await symlink(target, paths.projectPath)

    const result = await readSettings(paths)

    expect(result.settings).toEqual(DEFAULT_SETTINGS)
    expect(result.warnings).toEqual([
      expect.stringContaining("must not be a symbolic link"),
    ])
  })

  test("bounds settings reads before parsing", async () => {
    const paths = await tempPath()
    await mkdir(join(paths.dir, "project", ".opencode"), { recursive: true })
    await writeFile(
      paths.projectPath,
      " ".repeat(MAX_SETTINGS_FILE_BYTES + 1),
      "utf8",
    )

    const result = await readSettings(paths)

    expect(result.settings).toEqual(DEFAULT_SETTINGS)
    expect(result.warnings).toEqual([
      expect.stringContaining(
        `exceeds ${MAX_SETTINGS_FILE_BYTES} bytes`,
      ),
    ])
  })
})
