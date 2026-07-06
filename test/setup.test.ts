import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { DEFAULT_SETTINGS } from "../src/settings"
import {
  GITIGNORE_PROJECT_CONFIG_ENTRY,
  PROJECT_CONFIG_RELATIVE_PATH,
  applySetupDecision,
  getProjectGitignoreOption,
  shouldOpenFirstRunSetup,
} from "../src/setup"

const tempDirs: string[] = []

async function tempProject() {
  const dir = await mkdtemp(join(tmpdir(), "model-dispatch-setup-"))
  tempDirs.push(dir)
  return {
    root: dir,
    globalPath: join(dir, "global", "model-dispatch.json"),
    projectPath: join(dir, "project", ".opencode", "model-dispatch.json"),
    projectRoot: join(dir, "project"),
  }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })))
})

describe("setup backend", () => {
  test("opens first-run setup when no config exists unless setup is snoozed", async () => {
    const paths = await tempProject()

    await expect(shouldOpenFirstRunSetup(paths, { now: new Date("2026-01-01T00:00:00.000Z") })).resolves.toBe(true)

    await mkdir(join(paths.root, "global"), { recursive: true })
    await writeFile(paths.globalPath, JSON.stringify({ setup: { snoozed_until: new Date("2026-01-02T00:00:00.000Z").getTime() } }), "utf8")

    await expect(shouldOpenFirstRunSetup(paths, { now: new Date("2026-01-01T12:00:00.000Z") })).resolves.toBe(false)
  })

  test("setup cancel disables dispatch and writes the 24 hour snooze globally", async () => {
    const paths = await tempProject()
    const now = new Date("2026-01-01T00:00:00.000Z")

    const result = await applySetupDecision(paths, { kind: "cancel" }, { now })

    expect(result.messages).toContain("Setup cancelled. Model dispatch is disabled for now and setup is snoozed for 24 hours.")
    expect(JSON.parse(await readFile(paths.globalPath, "utf8"))).toEqual({
      dispatch: { enabled: false },
      setup: { snoozed_until: now.getTime() + 24 * 60 * 60 * 1000 },
    })
  })

  test("writes privacy globally and dispatch to the selected global scope", async () => {
    const paths = await tempProject()

    await applySetupDecision(paths, {
      kind: "submit",
      settings: { privacy: { logging_enabled: false }, dispatch: { ...DEFAULT_SETTINGS.dispatch, enabled: true, batch_ms: 250 } },
      dispatchScope: "global",
    })

    expect(JSON.parse(await readFile(paths.globalPath, "utf8"))).toEqual({
      privacy: { logging_enabled: false },
      dispatch: { ...DEFAULT_SETTINGS.dispatch, enabled: true, batch_ms: 250 },
    })
    await expect(readFile(paths.projectPath, "utf8")).rejects.toThrow()
  })

  test("writes dispatch to project config and updates gitignore when selected", async () => {
    const paths = await tempProject()
    await mkdir(join(paths.projectRoot, ".git"), { recursive: true })
    await writeFile(join(paths.projectRoot, ".gitignore"), "node_modules\n", "utf8")

    await expect(getProjectGitignoreOption(paths.projectRoot)).resolves.toEqual({ available: true, checked: true })

    const result = await applySetupDecision(paths, {
      kind: "submit",
      settings: { privacy: { logging_enabled: true }, dispatch: { ...DEFAULT_SETTINGS.dispatch, enabled: true } },
      dispatchScope: "project",
      addProjectConfigToGitignore: true,
    })

    expect(JSON.parse(await readFile(paths.globalPath, "utf8"))).toEqual({ privacy: { logging_enabled: true } })
    expect(JSON.parse(await readFile(paths.projectPath, "utf8"))).toEqual({ dispatch: { ...DEFAULT_SETTINGS.dispatch, enabled: true } })
    expect(await readFile(join(paths.projectRoot, ".gitignore"), "utf8")).toBe(`node_modules\n${GITIGNORE_PROJECT_CONFIG_ENTRY}\n`)
    expect(result.messages).toContain(`${PROJECT_CONFIG_RELATIVE_PATH} was added to .gitignore.`)
  })

  test("project config in a non-git project reports that no gitignore update is needed", async () => {
    const paths = await tempProject()

    await expect(getProjectGitignoreOption(paths.projectRoot)).resolves.toEqual({ available: false, checked: false })

    const result = await applySetupDecision(paths, {
      kind: "submit",
      settings: { privacy: { logging_enabled: true }, dispatch: { ...DEFAULT_SETTINGS.dispatch, enabled: true } },
      dispatchScope: "project",
      addProjectConfigToGitignore: true,
    })

    expect(JSON.parse(await readFile(paths.projectPath, "utf8"))).toEqual({ dispatch: { ...DEFAULT_SETTINGS.dispatch, enabled: true } })
    expect(result.messages).toContain("Project is not a git repo; no .gitignore update needed.")
  })

  test("reset to defaults writes default privacy globally and default dispatch to selected scope", async () => {
    const paths = await tempProject()

    await applySetupDecision(paths, { kind: "reset", dispatchScope: "project" })

    expect(JSON.parse(await readFile(paths.globalPath, "utf8"))).toEqual({ privacy: DEFAULT_SETTINGS.privacy })
    expect(JSON.parse(await readFile(paths.projectPath, "utf8"))).toEqual({ dispatch: DEFAULT_SETTINGS.dispatch })
  })
})
