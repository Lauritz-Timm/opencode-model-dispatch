import { spawnSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

import { hasReleaseNotesSection } from "./release-notes"

const root = fileURLToPath(new URL("../", import.meta.url))

export const REQUIRED_TRACKED_RELEASE_PATHS = [
  ".gitattributes",
  ".npmignore",
  ".github/ISSUE_TEMPLATE/bug_report.md",
  ".github/ISSUE_TEMPLATE/config.yml",
  ".github/ISSUE_TEMPLATE/feature_request.md",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/dependabot.yml",
  ".github/workflows/ci.yml",
  ".github/workflows/compatibility.yml",
  ".github/workflows/publish.yml",
  "AGENTS.md",
  "CHANGELOG.md",
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
  "LICENSE",
  "README.md",
  "SECURITY.md",
  "THIRD_PARTY_NOTICES.md",
  "bin/picker.js",
  "bun.lock",
  "docs/architecture.md",
  "docs/compatibility.md",
  "docs/development.md",
  "docs/manual-integration-gate.md",
  "docs/releasing.md",
  "package.json",
  "picker/bun.lock",
  "picker/package.json",
  "picker/src-tauri/Cargo.lock",
  "picker/src-tauri/Cargo.toml",
  "picker/src-tauri/tauri.conf.json",
  "rust-toolchain.toml",
  "scripts/check-release-ci.ts",
  "scripts/test-apple-notary-log-validator.sh",
  "scripts/validate-apple-notary-log.swift",
  "scripts/generate-third-party-notices.ts",
  "scripts/resolve-opencode-compatibility.ts",
  "third-party/RUST_THIRD_PARTY_LICENSES.md",
  "third-party/about.hbs",
  "third-party/about.toml",
  "third-party/components.json",
  "third-party/licenses/opencode-MIT.txt",
  "third-party/licenses/svelte-MIT.txt",
  "third-party/licenses/tauri-MIT.txt",
] as const

export interface ReleaseSourceEvaluationInput {
  porcelain: string
  trackedPaths: readonly string[]
  packageVersion: unknown
  changelog: string
  headCommit?: string
  originMainCommit?: string
  releaseTag?: string
  releaseTagCommit?: string
}

export function releaseSourceFailures(
  input: ReleaseSourceEvaluationInput,
): string[] {
  const failures: string[] = []
  const changes = input.porcelain
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)

  if (changes.length > 0) {
    const preview = changes.slice(0, 8).join(", ")
    const remainder =
      changes.length > 8 ? `, and ${changes.length - 8} more` : ""
    failures.push(
      `release source worktree must be clean, including untracked files; found ${changes.length} change(s): ${preview}${remainder}`,
    )
  }

  const trackedPaths = new Set(input.trackedPaths)
  for (const path of REQUIRED_TRACKED_RELEASE_PATHS) {
    if (!trackedPaths.has(path)) {
      failures.push(`required release file must be tracked by git: ${path}`)
    }
  }

  if (
    typeof input.packageVersion !== "string" ||
    input.packageVersion.trim() !== input.packageVersion ||
    input.packageVersion.length === 0
  ) {
    failures.push("package.json version must be a nonempty string without surrounding whitespace")
  } else if (!hasReleaseNotesSection(input.changelog, input.packageVersion)) {
    failures.push(
      `CHANGELOG.md must contain exactly one nonempty level-two release section for package version ${input.packageVersion}`,
    )
  }

  if (!input.headCommit) {
    failures.push("HEAD must resolve to a commit")
  }
  if (!input.originMainCommit) {
    failures.push("origin/main must resolve to a commit; fetch or push main before release")
  } else if (
    input.headCommit
    && input.headCommit.toLowerCase() !== input.originMainCommit.toLowerCase()
  ) {
    failures.push(
      `HEAD ${shortCommit(input.headCommit)} must equal origin/main ${shortCommit(input.originMainCommit)}`,
    )
  }

  if (input.releaseTag !== undefined) {
    if (
      input.releaseTag.length === 0 ||
      input.releaseTag.trim() !== input.releaseTag
    ) {
      failures.push("RELEASE_TAG must be nonempty and have no surrounding whitespace when set")
    } else if (!input.releaseTagCommit) {
      failures.push(`release tag ${input.releaseTag} must resolve to a commit`)
    } else if (
      input.headCommit &&
      input.releaseTagCommit.toLowerCase() !== input.headCommit.toLowerCase()
    ) {
      failures.push(
        `release tag ${input.releaseTag} resolves to ${shortCommit(input.releaseTagCommit)}, not HEAD ${shortCommit(input.headCommit)}`,
      )
    }
  }

  return failures
}

function shortCommit(commit: string): string {
  return commit.slice(0, 12)
}

async function main(): Promise<void> {
  const packageManifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as { version?: unknown }
  const changelog = await readFile(
    new URL("../CHANGELOG.md", import.meta.url),
    "utf8",
  )
  const headCommit = gitOutput([
    "rev-parse",
    "--verify",
    "HEAD^{commit}",
  ]).trim()
  const originMainCommit = gitOutputOptional([
    "rev-parse",
    "--verify",
    "refs/remotes/origin/main^{commit}",
  ])
  const releaseTag = process.env.RELEASE_TAG
  const releaseTagCommit =
    releaseTag &&
    releaseTag.trim() === releaseTag &&
    gitSucceeds(["check-ref-format", `refs/tags/${releaseTag}`])
      ? gitOutputOptional([
          "rev-parse",
          "--verify",
          `refs/tags/${releaseTag}^{commit}`,
        ])
      : undefined

  const failures = releaseSourceFailures({
    porcelain: gitOutput([
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
    ]),
    trackedPaths: gitOutput(["ls-files", "-z"])
      .split("\0")
      .filter(Boolean),
    packageVersion: packageManifest.version,
    changelog,
    headCommit,
    originMainCommit,
    releaseTag,
    releaseTagCommit,
  })

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`release source check failed: ${failure}`)
    }
    process.exit(1)
  }

  const tagMessage = releaseTag ? ` and tag ${releaseTag}` : ""
  console.log(
    `release source check passed: clean tracked source at ${shortCommit(headCommit)} equals origin/main${tagMessage}`,
  )
}

function gitOutput(args: string[]): string {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
  })
  if (result.status !== 0) {
    throw new Error(
      result.stderr.trim() ||
        `git ${args[0] ?? "command"} exited with ${result.status ?? "no status"}`,
    )
  }
  return result.stdout
}

function gitOutputOptional(args: string[]): string | undefined {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
  })
  return result.status === 0 ? result.stdout.trim() : undefined
}

function gitSucceeds(args: string[]): boolean {
  return spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
  }).status === 0
}

if (import.meta.main) {
  try {
    await main()
  } catch (error) {
    console.error(
      `release source check failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    process.exit(1)
  }
}
