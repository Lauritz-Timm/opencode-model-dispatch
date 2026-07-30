import { describe, expect, test } from "bun:test"

import { extractReleaseNotes, hasReleaseNotesSection } from "../scripts/release-notes"

describe("release notes extraction", () => {
  test("extracts exactly the requested version section with supported spacing", () => {
    const changelog = [
      "# Changelog",
      "",
      "##  0.1.0\t- 2026-07-28  ",
      "",
      "- Stable release.",
      "",
      "## 0.0.9 - 2026-07-01",
      "",
      "- Previous release.",
      "",
    ].join("\n")

    expect(extractReleaseNotes(changelog, "0.1.0")).toBe("- Stable release.\n")
    expect(hasReleaseNotesSection(changelog, "0.1.0")).toBe(true)
  })

  test("does not confuse prerelease, build, or prefix versions", () => {
    const changelog = [
      "# Changelog",
      "",
      "## 0.1.0-rc.1",
      "",
      "- Candidate.",
      "",
      "## 0.1.00",
      "",
      "- Different version.",
      "",
    ].join("\n")

    expect(() => extractReleaseNotes(changelog, "0.1.0")).toThrow(
      "found 0",
    )
    expect(hasReleaseNotesSection(changelog, "0.1.0")).toBe(false)
  })

  test("rejects duplicate or empty matching sections", () => {
    expect(() => extractReleaseNotes(
      "## 0.1.0\n\n- One.\n\n## 0.1.0 - duplicate\n\n- Two.\n",
      "0.1.0",
    )).toThrow("found 2")
    expect(() => extractReleaseNotes(
      "## 0.1.0\n\n## 0.0.9\n\n- Previous.\n",
      "0.1.0",
    )).toThrow("must not be empty")
  })
})
