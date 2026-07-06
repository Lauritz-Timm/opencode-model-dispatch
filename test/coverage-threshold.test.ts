import { describe, expect, test } from "bun:test"

const root = new URL("../", import.meta.url)

async function readText(path: string): Promise<string> {
  return await Bun.file(new URL(path, root)).text()
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readText(path)) as T
}

describe("coverage gate", () => {
  test("package scripts enforce at least 80 percent line coverage", async () => {
    const pkg = await readJson<{ scripts?: Record<string, string> }>("package.json")
    const script = await readText("scripts/check-coverage.ts")
    const workflow = await readText(".github/workflows/ci.yml")

    expect(pkg.scripts?.coverage).toBe("bun test --coverage --coverage-reporter=lcov")
    expect(pkg.scripts?.["check:coverage"]).toBe("bun run coverage && bun run scripts/check-coverage.ts")
    expect(pkg.scripts?.test).toBe("bun test")
    expect(script).toContain("MIN_LINE_COVERAGE = 80")
    expect(script).toContain("coverage/lcov.info")
    expect(workflow).toContain("bun run check:coverage")
  })
})
