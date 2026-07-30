import { describe, expect, test } from "bun:test"

import {
  OPENCODE_MINOR_HISTORY,
  resolveOpenCodeCompatibilityTargets,
} from "../scripts/resolve-opencode-compatibility"

const root = new URL("../", import.meta.url)

async function readText(path: string): Promise<string> {
  return await Bun.file(new URL(path, root)).text()
}

describe("OpenCode compatibility policy", () => {
  test("selects the exact minimum and latest patch in each active minor", () => {
    expect(resolveOpenCodeCompatibilityTargets(
      ">=1.18.7 <2",
      [
        "1.18.6",
        "1.18.7",
        "1.18.9",
        "1.18.10-beta.1",
        "1.18.10",
        "1.19.0",
        "2.0.0",
        "1.19.0",
      ],
    )).toEqual([
      { line: "1.18.x", role: "minimum", version: "1.18.7" },
      { line: "1.18.x", role: "minor-latest", version: "1.18.10" },
      { line: "1.19.x", role: "minor-latest", version: "1.19.0" },
    ])
  })

  test("runs one target when the minimum is also the latest patch", () => {
    expect(resolveOpenCodeCompatibilityTargets(
      ">=1.18.7 <2",
      ["1.18.6", "1.18.7", "2.0.0-rc.1"],
    )).toEqual([
      {
        line: "1.18.x",
        role: "minimum-and-minor-latest",
        version: "1.18.7",
      },
    ])
  })

  test("keeps the current minor and five prior minor lines", () => {
    expect(OPENCODE_MINOR_HISTORY).toBe(5)
    expect(resolveOpenCodeCompatibilityTargets(
      ">=1.18.7 <2",
      [
        "1.18.7",
        "1.18.9",
        "1.19.0",
        "1.19.3",
        "1.20.0",
        "1.21.1",
        "1.22.0",
        "1.23.0",
        "1.23.2",
        "1.24.0",
      ],
    )).toEqual([
      { line: "1.19.x", role: "minor-latest", version: "1.19.3" },
      { line: "1.20.x", role: "minor-latest", version: "1.20.0" },
      { line: "1.21.x", role: "minor-latest", version: "1.21.1" },
      { line: "1.22.x", role: "minor-latest", version: "1.22.0" },
      { line: "1.23.x", role: "minor-latest", version: "1.23.2" },
      { line: "1.24.x", role: "minor-latest", version: "1.24.0" },
    ])
  })

  test("retains the previous major through five new-major minor advances", () => {
    const throughTwoFour = [
      "1.18.7",
      "1.18.9",
      "2.0.0",
      "2.1.0",
      "2.2.0",
      "2.3.0",
      "2.4.0",
    ]
    expect(resolveOpenCodeCompatibilityTargets(
      ">=1.18.7 <3",
      throughTwoFour,
    ).map(({ line }) => line)).toContain("1.18.x")

    expect(resolveOpenCodeCompatibilityTargets(
      ">=1.18.7 <3",
      [...throughTwoFour, "2.5.0"],
    ).map(({ line }) => line)).toEqual([
      "2.0.x",
      "2.1.x",
      "2.2.x",
      "2.3.x",
      "2.4.x",
      "2.5.x",
    ])
  })

  test("fails closed for malformed policy or registry data", () => {
    expect(() =>
      resolveOpenCodeCompatibilityTargets("^1.18.7", ["1.18.7"])
    ).toThrow("explicit form >=x.y.z <N")
    expect(() =>
      resolveOpenCodeCompatibilityTargets(">=2.0.0 <2", ["2.0.0"])
    ).toThrow("invalid OpenCode engine range")
    expect(() =>
      resolveOpenCodeCompatibilityTargets(">=1.18.7 <2", "1.18.7")
    ).toThrow("must be an array")
    expect(() =>
      resolveOpenCodeCompatibilityTargets(">=1.18.7 <2", ["1.18.7", 1])
    ).toThrow("only strings")
    expect(() =>
      resolveOpenCodeCompatibilityTargets(">=1.18.7 <2", ["1.18.8"])
    ).toThrow("minimum OpenCode 1.18.7 is not published")
  })

  test("nightly workflow discovers and exercises exact read-only targets", async () => {
    const workflow = await readText(".github/workflows/compatibility.yml")
    const documentation = await readText("docs/compatibility.md")
    const packageManifest = JSON.parse(
      await readText("package.json"),
    ) as { version?: unknown }

    expect(workflow).toContain("schedule:")
    expect(workflow).toContain('cron: "17 2 * * *"')
    expect(workflow).toContain("workflow_dispatch:")
    expect(workflow).toContain("permissions:\n  contents: read")
    expect(workflow).toContain("scripts/resolve-opencode-compatibility.ts")
    expect(workflow).toContain("current and five prior minor lines")
    expect(workflow).toContain(
      "target: ${{ fromJSON(needs.discover.outputs.targets) }}",
    )
    expect(workflow).toContain(
      '"opencode-ai@${{ matrix.target.version }}"',
    )
    expect(workflow).toContain("bun run test:opencode")
    expect(workflow).toContain(
      "OPENCODE_TEST_VERSION: ${{ matrix.target.version }}",
    )
    expect(workflow).not.toContain("${{ secrets.")
    expect(workflow).not.toMatch(/\b(?:contents|issues|pull-requests): write\b/)

    const actions = [...workflow.matchAll(/uses:\s+([^\s]+)/g)]
      .map((match) => match[1])
    expect(actions.length).toBeGreaterThan(0)
    for (const action of actions) {
      expect(action).toMatch(/@[0-9a-f]{40}$/)
    }

    expect(documentation).toContain(
      "| OpenCode version | Latest `opencode-model-dispatch` release tested |",
    )
    expect(documentation).toContain(
      "| `1.18.7` | `0.1.0` | Real dispatch and same-agent FIFO |",
    )
    expect(documentation).toContain(
      "| `1.18.9` | `0.1.0` | Real dispatch and same-agent FIFO |",
    )
    expect(documentation).toMatch(
      /current\s+supported OpenCode minor line and the five\s+previous lines/,
    )
    expect(documentation).toContain("Rows are never removed")
    expect(documentation).toContain("Newer plugin versions may still work")
    expect(documentation).toMatch(
      /absent from the\s+table has no tested compatibility guarantee/,
    )
    expect(documentation).toContain("Prereleases are excluded")
    expect(documentation).toContain("new major version is also excluded")
    expect(typeof packageManifest.version).toBe("string")
    const activeRows = documentation
      .split("\n")
      .filter((line) => /\|\s*Rolling (?:minimum|minor latest)\s*\|\s*$/.test(line))
    expect(activeRows.length).toBeGreaterThan(0)
    for (const row of activeRows) {
      const columns = row
        .split("|")
        .slice(1, -1)
        .map((column) => column.trim())
      expect(columns).toHaveLength(4)
      expect(columns[1]).toBe(`\`${packageManifest.version}\``)
    }
    expect(workflow).toContain(
      "node -p \"require('./package.json').version\"",
    )
    expect(workflow).toContain(
      "| OpenCode | opencode-model-dispatch | Target | Result |",
    )
  })
})
