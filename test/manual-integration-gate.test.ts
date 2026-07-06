import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"

describe("manual OpenCode integration gate", () => {
  test("documents every manual release gate before release continues", async () => {
    const gate = await readFile("docs/manual-integration-gate.md", "utf8")

    for (const required of [
      "Local OpenCode starts with the plugin installed in a scratch project",
      "First-run setup opens at plugin load",
      "Dispatch remains disabled if setup is cancelled and snoozed",
      "Enabling dispatch works",
      "One built-in `task` opens the picker and selection overrides the model",
      "Multiple parallel `task` calls batch into one picker",
      "Apply-to-all and per-row selections both work",
      "Child sessions show original agent names in TUI/Desktop history",
      "Technical picker failure falls back to built-in task default/current model with warning",
      "Explicit cancel starts no subagents",
      "Archiving child sessions triggers shadow cleanup",
      "Any failed hard gate or manual check is documented before release continues",
    ]) {
      expect(gate).toContain(required)
    }

    expect(gate).toContain("Status: not run in this checkout")
  })
})
