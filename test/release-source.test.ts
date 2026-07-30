import { describe, expect, test } from "bun:test"

import {
  REQUIRED_TRACKED_RELEASE_PATHS,
  releaseSourceFailures,
  type ReleaseSourceEvaluationInput,
} from "../scripts/check-release-source"

const head = "0123456789abcdef0123456789abcdef01234567"
const otherCommit = "89abcdef0123456789abcdef0123456789abcdef"

function releaseSource(
  overrides: Partial<ReleaseSourceEvaluationInput> = {},
): ReleaseSourceEvaluationInput {
  return {
    porcelain: "",
    trackedPaths: [...REQUIRED_TRACKED_RELEASE_PATHS],
    packageVersion: "0.1.0",
    changelog: "# Changelog\n\n## 0.1.0 - 2026-07-28\n\n- Initial release.\n",
    headCommit: head,
    originMainCommit: head,
    ...overrides,
  }
}

describe("release source preflight", () => {
  test("accepts clean, tracked source equal to origin/main and an optional matching tag", () => {
    expect(releaseSourceFailures(releaseSource())).toEqual([])
    expect(releaseSourceFailures(releaseSource({
      releaseTag: "v0.1.0",
      releaseTagCommit: head,
    }))).toEqual([])
  })

  test("rejects tracked and untracked worktree changes with a bounded preview", () => {
    const changes = [
      " M README.md",
      "?? local-one",
      "?? local-two",
      "?? local-three",
      "?? local-four",
      "?? local-five",
      "?? local-six",
      "?? local-seven",
      "?? local-eight",
      "?? local-nine",
    ].join("\n")

    expect(releaseSourceFailures(releaseSource({ porcelain: changes }))).toEqual([
      "release source worktree must be clean, including untracked files; found 10 change(s):  M README.md, ?? local-one, ?? local-two, ?? local-three, ?? local-four, ?? local-five, ?? local-six, ?? local-seven, and 2 more",
    ])
  })

  test("requires lockfiles, public docs, release tooling, and workflows to be tracked", () => {
    const missing = new Set([
      ".npmignore",
      ".github/workflows/compatibility.yml",
      "bun.lock",
      "docs/compatibility.md",
      "picker/bun.lock",
      "picker/src-tauri/Cargo.lock",
      "scripts/manual-candidate-support.ts",
      "scripts/resolve-opencode-compatibility.ts",
      "third-party/about.toml",
      "third-party/RUST_THIRD_PARTY_LICENSES.md",
      "SECURITY.md",
      ".github/workflows/publish.yml",
      ".github/dependabot.yml",
    ])
    const failures = releaseSourceFailures(releaseSource({
      trackedPaths: REQUIRED_TRACKED_RELEASE_PATHS.filter(
        (path) => !missing.has(path),
      ),
    }))

    for (const path of missing) {
      expect(failures).toContain(
        `required release file must be tracked by git: ${path}`,
      )
    }
    expect(failures).toHaveLength(missing.size)
  })

  test("requires an exact changelog heading for the package version", () => {
    expect(releaseSourceFailures(releaseSource({
      packageVersion: "0.1.0",
      changelog: "# Changelog\n\n## 0.1.0-rc.1\n",
    }))).toContain(
      "CHANGELOG.md must contain exactly one nonempty level-two release section for package version 0.1.0",
    )
    expect(releaseSourceFailures(releaseSource({
      packageVersion: "1.2.3+local",
      changelog: "# Changelog\n\n## 1.2.3+local\n\n- Local release.\n",
    }))).toEqual([])
    expect(releaseSourceFailures(releaseSource({
      changelog: "# Changelog\n\n## 0.1.0\n",
    }))).toContain(
      "CHANGELOG.md must contain exactly one nonempty level-two release section for package version 0.1.0",
    )
    expect(releaseSourceFailures(releaseSource({
      packageVersion: " 0.1.0",
    }))).toContain(
      "package.json version must be a nonempty string without surrounding whitespace",
    )
  })

  test("requires HEAD to resolve and equal the local origin/main ref", () => {
    expect(releaseSourceFailures(releaseSource({
      headCommit: undefined,
      originMainCommit: undefined,
    }))).toEqual([
      "HEAD must resolve to a commit",
      "origin/main must resolve to a commit; fetch or push main before release",
    ])

    expect(releaseSourceFailures(releaseSource({
      originMainCommit: otherCommit,
    }))).toContain(
      "HEAD 0123456789ab must equal origin/main 89abcdef0123",
    )
  })

  test("requires a configured release tag to exist and resolve exactly to HEAD", () => {
    expect(releaseSourceFailures(releaseSource({
      releaseTag: " ",
    }))).toContain(
      "RELEASE_TAG must be nonempty and have no surrounding whitespace when set",
    )
    expect(releaseSourceFailures(releaseSource({
      releaseTag: "v0.1.0",
    }))).toContain(
      "release tag v0.1.0 must resolve to a commit",
    )
    expect(releaseSourceFailures(releaseSource({
      releaseTag: "v0.1.0",
      releaseTagCommit: otherCommit,
    }))).toContain(
      "release tag v0.1.0 resolves to 89abcdef0123, not HEAD 0123456789ab",
    )
  })
})
