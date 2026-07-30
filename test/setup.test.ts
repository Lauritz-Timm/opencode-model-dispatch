import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

import {
  DEFAULT_SETTINGS,
  MAX_SETTINGS_FILE_BYTES,
} from "../src/settings"
import {
  GITIGNORE_PROJECT_CONFIG_ENTRY,
  MAX_GITIGNORE_FILE_BYTES,
  PROJECT_CONFIG_RELATIVE_PATH,
  applySetupDecision,
  getConfiguredDispatchScope,
  getProjectGitignoreOption,
  parseSetupDecisionPayload,
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
  test("fails closed when the picker returns a missing or unknown setup scope", () => {
    const validSettings = {
      privacy: { logging_enabled: true },
      dispatch: { ...DEFAULT_SETTINGS.dispatch },
    }

    expect(parseSetupDecisionPayload({
      settings: validSettings,
      addProjectConfigToGitignore: false,
    })).toEqual({
      kind: "technical_failure",
      reason: "Picker returned an invalid setup payload",
    })
    expect(parseSetupDecisionPayload({
      scope: "workspace",
      settings: validSettings,
      addProjectConfigToGitignore: false,
    })).toEqual({
      kind: "technical_failure",
      reason: "Picker returned an invalid setup payload",
    })
  })

  test("parses exact global/project setup scopes and rejects malformed actions", () => {
    const settings = {
      privacy: { logging_enabled: false },
      dispatch: { ...DEFAULT_SETTINGS.dispatch, enabled: true },
    }

    expect(parseSetupDecisionPayload({
      scope: "global",
      settings,
      addProjectConfigToGitignore: false,
    })).toMatchObject({
      kind: "submit",
      dispatchScope: "global",
      settings,
    })
    expect(parseSetupDecisionPayload({
      action: "reset",
      scope: "project",
      addProjectConfigToGitignore: true,
    })).toEqual({
      kind: "reset",
      dispatchScope: "project",
      addProjectConfigToGitignore: true,
    })
    expect(parseSetupDecisionPayload({
      action: "unexpected",
      scope: "global",
      settings,
      addProjectConfigToGitignore: false,
    })).toMatchObject({ kind: "technical_failure" })
  })

  test("opens first-run setup when no config exists unless setup is snoozed", async () => {
    const paths = await tempProject()

    await expect(shouldOpenFirstRunSetup(paths, { now: new Date("2026-01-01T00:00:00.000Z") })).resolves.toBe(true)

    await mkdir(join(paths.root, "global"), { recursive: true })
    await writeFile(paths.globalPath, JSON.stringify({ setup: { snoozed_until: new Date("2026-01-02T00:00:00.000Z").getTime() } }), "utf8")

    await expect(shouldOpenFirstRunSetup(paths, { now: new Date("2026-01-01T12:00:00.000Z") })).resolves.toBe(false)
  })

  test("treats malformed settings as unconfigured instead of crashing plugin startup", async () => {
    const paths = await tempProject()
    await mkdir(join(paths.root, "global"), { recursive: true })
    await writeFile(paths.globalPath, "{not-json", "utf8")

    await expect(shouldOpenFirstRunSetup(paths)).resolves.toBe(true)
  })

  test("bounds and rejects repository-controlled settings during setup reads", async () => {
    const paths = await tempProject()
    await mkdir(join(paths.projectRoot, ".opencode"), { recursive: true })
    await writeFile(
      paths.projectPath,
      " ".repeat(MAX_SETTINGS_FILE_BYTES + 1),
      "utf8",
    )

    await expect(shouldOpenFirstRunSetup(paths)).rejects.toThrow(
      `settings file exceeds ${MAX_SETTINGS_FILE_BYTES} bytes`,
    )
    await expect(getConfiguredDispatchScope(paths)).rejects.toThrow(
      `settings file exceeds ${MAX_SETTINGS_FILE_BYTES} bytes`,
    )
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

  test("preserves appearance and unknown settings while updating setup-owned sections", async () => {
    const paths = await tempProject()
    await mkdir(join(paths.root, "global"), { recursive: true })
    await writeFile(paths.globalPath, JSON.stringify({
      appearance: { theme_id: "nightowl" },
      dispatch: { enabled: false, future_option: "keep" },
      future_section: { value: 42 },
    }), "utf8")

    await applySetupDecision(paths, {
      kind: "submit",
      settings: { privacy: { logging_enabled: false }, dispatch: { ...DEFAULT_SETTINGS.dispatch, enabled: true } },
      dispatchScope: "global",
    })

    expect(JSON.parse(await readFile(paths.globalPath, "utf8"))).toMatchObject({
      appearance: { theme_id: "nightowl" },
      dispatch: { enabled: true, future_option: "keep" },
      future_section: { value: 42 },
      privacy: { logging_enabled: false },
    })
  })

  test("writes dispatch to project config and updates gitignore when selected", async () => {
    const paths = await tempProject()
    await mkdir(join(paths.projectRoot, ".git"), { recursive: true })
    await writeFile(join(paths.projectRoot, ".gitignore"), "node_modules\n", "utf8")

    await expect(getProjectGitignoreOption(paths.projectRoot)).resolves.toEqual({ available: true, checked: false })

    const result = await applySetupDecision(paths, {
      kind: "submit",
      settings: { privacy: { logging_enabled: true }, dispatch: { ...DEFAULT_SETTINGS.dispatch, enabled: true } },
      dispatchScope: "project",
      addProjectConfigToGitignore: true,
    })

    expect(JSON.parse(await readFile(paths.globalPath, "utf8"))).toEqual({ privacy: { logging_enabled: true } })
    expect(JSON.parse(await readFile(paths.projectPath, "utf8"))).toEqual({ dispatch: { ...DEFAULT_SETTINGS.dispatch, enabled: true } })
    expect(await readFile(join(paths.projectRoot, ".gitignore"), "utf8")).toBe(`node_modules\n${GITIGNORE_PROJECT_CONFIG_ENTRY}\n`)
    await expect(getProjectGitignoreOption(paths.projectRoot)).resolves.toEqual({ available: true, checked: true })
    await expect(getConfiguredDispatchScope(paths)).resolves.toBe("project")
    expect(result.messages).toContain(`${PROJECT_CONFIG_RELATIVE_PATH} was added to .gitignore.`)

    const removeResult = await applySetupDecision(paths, {
      kind: "submit",
      settings: { privacy: { logging_enabled: true }, dispatch: { ...DEFAULT_SETTINGS.dispatch, enabled: true } },
      dispatchScope: "project",
      addProjectConfigToGitignore: false,
    })
    expect(await readFile(join(paths.projectRoot, ".gitignore"), "utf8")).toBe("node_modules\n")
    await expect(getProjectGitignoreOption(paths.projectRoot)).resolves.toEqual({ available: true, checked: false })
    expect(removeResult.messages).toContain(`${PROJECT_CONFIG_RELATIVE_PATH} was removed from .gitignore.`)
  })

  test("refuses repository-controlled project config symlinks", async () => {
    const paths = await tempProject()
    const outsideDirectory = join(paths.root, "outside")
    await mkdir(paths.projectRoot, { recursive: true })
    await mkdir(outsideDirectory, { recursive: true })
    await symlink(outsideDirectory, join(paths.projectRoot, ".opencode"), "dir")

    const decision = {
      kind: "submit" as const,
      settings: {
        privacy: { logging_enabled: true },
        dispatch: { ...DEFAULT_SETTINGS.dispatch, enabled: true },
      },
      dispatchScope: "project" as const,
    }

    await expect(
      applySetupDecision(paths, decision, { projectRoot: paths.projectRoot }),
    ).rejects.toThrow("symbolic-link .opencode")
    await expect(readFile(paths.globalPath, "utf8")).rejects.toThrow()
    await expect(readFile(join(outsideDirectory, "model-dispatch.json"), "utf8")).rejects.toThrow()

    await unlink(join(paths.projectRoot, ".opencode"))
    await mkdir(join(paths.projectRoot, ".opencode"), { recursive: true })
    const outsideFile = join(outsideDirectory, "unrelated.json")
    await writeFile(outsideFile, "{\"keep\":true}\n", "utf8")
    await symlink(outsideFile, paths.projectPath)

    await expect(shouldOpenFirstRunSetup(paths)).rejects.toThrow(
      "settings file must not be a symbolic link",
    )
    await expect(getConfiguredDispatchScope(paths)).rejects.toThrow(
      "settings file must not be a symbolic link",
    )

    await expect(
      applySetupDecision(paths, decision, { projectRoot: paths.projectRoot }),
    ).rejects.toThrow("symbolic-link .opencode/model-dispatch.json")
    expect(await readFile(outsideFile, "utf8")).toBe("{\"keep\":true}\n")
  })

  test("does not follow a repository-controlled gitignore symlink", async () => {
    const paths = await tempProject()
    await mkdir(join(paths.projectRoot, ".git"), { recursive: true })
    const outsideFile = join(paths.root, "outside-gitignore")
    await writeFile(outsideFile, "keep-this\n", "utf8")
    await symlink(outsideFile, join(paths.projectRoot, ".gitignore"))

    await expect(getProjectGitignoreOption(paths.projectRoot)).resolves.toEqual({
      available: false,
      checked: false,
    })
    const result = await applySetupDecision(paths, {
      kind: "submit",
      settings: {
        privacy: { logging_enabled: true },
        dispatch: { ...DEFAULT_SETTINGS.dispatch, enabled: true },
      },
      dispatchScope: "project",
      addProjectConfigToGitignore: true,
    }, { projectRoot: paths.projectRoot })

    expect(await readFile(outsideFile, "utf8")).toBe("keep-this\n")
    expect(result.messages).toContain(
      "The project's .gitignore is a symbolic link and was not modified.",
    )
  })

  test("does not load or rewrite an oversized repository gitignore", async () => {
    const paths = await tempProject()
    await mkdir(join(paths.projectRoot, ".git"), { recursive: true })
    const gitignorePath = join(paths.projectRoot, ".gitignore")
    const oversized = "x".repeat(MAX_GITIGNORE_FILE_BYTES + 1)
    await writeFile(gitignorePath, oversized, "utf8")

    await expect(getProjectGitignoreOption(paths.projectRoot)).resolves.toEqual({
      available: false,
      checked: false,
    })
    const result = await applySetupDecision(paths, {
      kind: "submit",
      settings: {
        privacy: { logging_enabled: true },
        dispatch: { ...DEFAULT_SETTINGS.dispatch, enabled: true },
      },
      dispatchScope: "project",
      addProjectConfigToGitignore: true,
    }, { projectRoot: paths.projectRoot })

    expect(await readFile(gitignorePath, "utf8")).toBe(oversized)
    expect(result.messages).toContain(
      `The project's .gitignore was not modified: .gitignore exceeds ${MAX_GITIGNORE_FILE_BYTES} bytes.`,
    )
  })

  test("switching to global clears the project dispatch override and preserves unrelated project settings", async () => {
    const paths = await tempProject()
    await mkdir(join(paths.projectRoot, ".opencode"), { recursive: true })
    await writeFile(paths.projectPath, JSON.stringify({
      dispatch: { ...DEFAULT_SETTINGS.dispatch, enabled: false },
      future_section: { keep: true },
    }), "utf8")

    const result = await applySetupDecision(paths, {
      kind: "submit",
      settings: { privacy: { logging_enabled: true }, dispatch: { ...DEFAULT_SETTINGS.dispatch, enabled: true } },
      dispatchScope: "global",
    })

    expect(JSON.parse(await readFile(paths.projectPath, "utf8"))).toEqual({ future_section: { keep: true } })
    await expect(getConfiguredDispatchScope(paths)).resolves.toBe("global")
    expect(result.messages).toContain("The existing project dispatch override was cleared so global settings take effect.")
  })

  test("recognizes Git worktrees where .git is a file", async () => {
    const paths = await tempProject()
    await mkdir(paths.projectRoot, { recursive: true })
    await writeFile(join(paths.projectRoot, ".git"), "gitdir: ../.git/worktrees/project\n", "utf8")

    await expect(getProjectGitignoreOption(paths.projectRoot)).resolves.toEqual({ available: true, checked: false })
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
