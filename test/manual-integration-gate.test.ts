import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"

import {
  manualGateCommitFailures,
  manualGateFailures,
} from "../scripts/check-manual-gate"

const testedCommit = "0123456789abcdef0123456789abcdef01234567"
const evidenceCommit = "89abcdef0123456789abcdef0123456789abcdef"

describe("manual OpenCode integration gate", () => {
  test("documents every manual release gate before release continues", async () => {
    const gate = await readFile("docs/manual-integration-gate.md", "utf8")

    for (const required of [
      "Local OpenCode starts with the plugin installed in a scratch project",
      "`bun run release:manual-candidate:test` installs the retained npm tarball",
      "First-run setup opens at plugin load",
      "Dispatch remains disabled if setup is cancelled and snoozed",
      "Enabling dispatch works",
      "One built-in `task` in TUI opens the picker and selection overrides the model",
      "One built-in `task` in Desktop opens the picker and selection overrides the model",
      "Multiple parallel `task` calls batch into one picker",
      "Apply-to-all and per-row selections both work",
      "Child sessions show original agent names in TUI/Desktop history",
      "Technical picker failure falls back to built-in task default/current model with warning",
      "Explicit cancel starts no subagents",
      "Child session messages and task metadata record the selected model",
      "Auto/default effort works in both TUI and Desktop",
      "An explicit provider-advertised effort can be selected in both TUI and Desktop",
      "Child history and task metadata preserve the explicit effort",
      "Every hard gate and manual check above passed",
    ]) {
      expect(gate).toContain(required)
    }

    expect(gate).toMatch(/^Status:/m)
    expect(gate).toContain("Open a pull request and merge it through the protected `main` workflow")
    expect(gate).toContain("do not push the evidence commit directly to `main`")
    expect(gate).toContain("CI push run for that exact merged SHA")
  })

  test("release check fails closed until status, checklist, and evidence are complete", async () => {
    const currentGate = await readFile("docs/manual-integration-gate.md", "utf8")
    expect(manualGateFailures(currentGate)).toContain(
      "manual integration gate status must be passed",
    )

    const passed = currentGate
      .replace("Status: not run in this checkout.", "Status: passed.")
      .replaceAll("- [ ]", "- [x]")
      .replace("- Date: not recorded", "- Date: 2026-07-27")
      .replace("- Operator: not recorded", "- Operator: release-tester")
      .replace("- Commit SHA: not recorded", `- Commit SHA: ${testedCommit}`)
      .replace("- OpenCode version: not recorded", "- OpenCode version: 1.18.7")
      .replace("- Plugin package or tarball: not recorded", "- Plugin package or tarball: opencode-model-dispatch-0.1.0.tgz")
      .replace("- npm tarball SHA-512: not recorded", `- npm tarball SHA-512: sha512-${"a".repeat(86)}==`)
      .replace("- Picker asset path: not recorded", "- Picker asset path: dist-picker/picker-linux-x64")
      .replace("- Picker SHA-256: not recorded", `- Picker SHA-256: ${"b".repeat(64)}`)
      .replace("- Scratch project path: not recorded", "- Scratch project path: <temp>/model-dispatch-release")
      .replace("- TUI platform: not recorded", "- TUI platform: Linux x64")
      .replace("- Desktop platform: not recorded", "- Desktop platform: macOS arm64")
      .replace("- TUI result: not run", "- TUI result: passed")
      .replace("- Desktop result: not run", "- Desktop result: passed")

    expect(manualGateFailures(passed)).toEqual([])
    expect(manualGateFailures(passed.replace("- TUI result: passed", "- TUI result: failed"))).toContain(
      "manual integration evidence TUI result must be passed",
    )
    expect(manualGateFailures(passed.replace(testedCommit, "0123456789abcdef"))).toContain(
      "manual integration evidence Commit SHA must be a full 40-character hexadecimal commit",
    )
    expect(manualGateFailures(passed.replace(
      `sha512-${"a".repeat(86)}==`,
      "sha512-invalid",
    ))).toContain(
      "manual integration evidence npm tarball SHA-512 must be a SHA-512 SRI value",
    )
    expect(manualGateFailures(passed.replace(
      `- Picker SHA-256: ${"b".repeat(64)}`,
      "- Picker SHA-256: abc123",
    ))).toContain(
      "manual integration evidence Picker SHA-256 must be 64 hexadecimal characters",
    )
    expect(manualGateFailures(
      passed.replace("- Operator: release-tester", "- Operator: Real Person"),
    )).toContain(
      "manual integration evidence Operator must be a public handle without spaces",
    )
    expect(manualGateFailures(
      passed.replace(
        "- Scratch project path: <temp>/model-dispatch-release",
        "- Scratch project path: /home/person/client-name",
      ),
    )).toContain(
      "manual integration evidence Scratch project path must use the sanitized <temp>/... form",
    )
  })

  test("binds evidence to the current commit or an evidence-only descendant", async () => {
    const currentGate = await readFile("docs/manual-integration-gate.md", "utf8")
    const passed = currentGate.replace(
      "- Commit SHA: not recorded",
      `- Commit SHA: ${testedCommit}`,
    )

    expect(
      manualGateCommitFailures(passed, {
        currentCommit: testedCommit,
        testedCommitIsAncestor: true,
        changedFiles: [],
      }),
    ).toEqual([])
    expect(
      manualGateCommitFailures(passed, {
        currentCommit: evidenceCommit,
        testedCommitIsAncestor: true,
        changedFiles: ["docs/manual-integration-gate.md"],
      }),
    ).toEqual([])
    expect(
      manualGateCommitFailures(passed, {
        currentCommit: evidenceCommit,
        testedCommitIsAncestor: true,
        changedFiles: ["README.md", "docs/manual-integration-gate.md"],
      }),
    ).toContain(
      "changes after the tested Commit SHA must contain only docs/manual-integration-gate.md",
    )
    expect(
      manualGateCommitFailures(passed, {
        currentCommit: evidenceCommit,
        testedCommitIsAncestor: false,
        changedFiles: [],
      }),
    ).toContain(
      "manual integration evidence Commit SHA must be the current commit or an ancestor of it",
    )
  })
})
