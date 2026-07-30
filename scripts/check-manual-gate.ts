import { spawnSync } from "node:child_process"
import { readFile } from "node:fs/promises"

const manualGatePath = "docs/manual-integration-gate.md"
const fullCommitPattern = /^[0-9a-f]{40}$/i
const npmIntegrityPattern = /^sha512-[A-Za-z0-9+/]{86}==$/
const sha256Pattern = /^[0-9a-f]{64}$/i
const semanticVersionPattern = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/

const evidenceFields = [
  "Date",
  "Operator",
  "Commit SHA",
  "OpenCode version",
  "Plugin package or tarball",
  "npm tarball SHA-512",
  "Picker asset path",
  "Picker SHA-256",
  "Scratch project path",
  "TUI platform",
  "Desktop platform",
  "TUI result",
  "Desktop result",
]

export interface ManualGateCommitContext {
  currentCommit: string
  testedCommitIsAncestor: boolean
  changedFiles: string[]
}

export function manualGateFailures(contents: string): string[] {
  const failures: string[] = []
  if (!/^Status:\s*passed\.?\s*$/im.test(contents)) {
    failures.push("manual integration gate status must be passed")
  }

  const unchecked = contents.match(/^- \[ \] .+$/gm) ?? []
  if (unchecked.length > 0) {
    failures.push(`manual integration gate has ${unchecked.length} unchecked checklist item(s)`)
  }

  const evidence = contents.match(/## Evidence\s+([\s\S]*?)(?=\n## |\s*$)/)?.[1] ?? ""
  for (const field of evidenceFields) {
    const value = evidenceValue(evidence, field)
    if (!isRecordedEvidence(value)) {
      failures.push(`manual integration evidence must record ${field}`)
    }
  }
  const testedCommit = evidenceValue(evidence, "Commit SHA")
  if (isRecordedEvidence(testedCommit) && !fullCommitPattern.test(testedCommit)) {
    failures.push(
      "manual integration evidence Commit SHA must be a full 40-character hexadecimal commit",
    )
  }
  const date = evidenceValue(evidence, "Date")
  if (isRecordedEvidence(date) && !isIsoDate(date)) {
    failures.push("manual integration evidence Date must be a valid YYYY-MM-DD date")
  }
  const openCodeVersion = evidenceValue(evidence, "OpenCode version")
  if (
    isRecordedEvidence(openCodeVersion)
    && !semanticVersionPattern.test(openCodeVersion)
  ) {
    failures.push("manual integration evidence OpenCode version must be a semantic version")
  }
  const npmIntegrity = evidenceValue(evidence, "npm tarball SHA-512")
  if (
    isRecordedEvidence(npmIntegrity)
    && !npmIntegrityPattern.test(npmIntegrity)
  ) {
    failures.push("manual integration evidence npm tarball SHA-512 must be a SHA-512 SRI value")
  }
  const pickerSha = evidenceValue(evidence, "Picker SHA-256")
  if (isRecordedEvidence(pickerSha) && !sha256Pattern.test(pickerSha)) {
    failures.push("manual integration evidence Picker SHA-256 must be 64 hexadecimal characters")
  }
  const operator = evidenceValue(evidence, "Operator")
  if (
    isRecordedEvidence(operator)
    && !/^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,63})$/.test(operator)
  ) {
    failures.push(
      "manual integration evidence Operator must be a public handle without spaces",
    )
  }
  const packagePath = evidenceValue(evidence, "Plugin package or tarball")
  if (
    isRecordedEvidence(packagePath)
    && !/^[A-Za-z0-9][A-Za-z0-9._-]*\.tgz$/.test(packagePath)
  ) {
    failures.push(
      "manual integration evidence Plugin package or tarball must be a sanitized tarball filename",
    )
  }
  const pickerPath = evidenceValue(evidence, "Picker asset path")
  if (
    isRecordedEvidence(pickerPath)
    && !/^(?:bin|dist-picker)\/[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(pickerPath)
  ) {
    failures.push(
      "manual integration evidence Picker asset path must be a sanitized repository-relative path",
    )
  }
  const scratchPath = evidenceValue(evidence, "Scratch project path")
  if (
    isRecordedEvidence(scratchPath)
    && !/^<temp>[\\/][A-Za-z0-9][A-Za-z0-9._/\\-]*$/.test(scratchPath)
  ) {
    failures.push(
      "manual integration evidence Scratch project path must use the sanitized <temp>/... form",
    )
  }
  for (const field of ["TUI result", "Desktop result"]) {
    const value = evidenceValue(evidence, field)
    if (
      value &&
      isRecordedEvidence(value) &&
      !/^passed(?:\s*[:—-]\s*.+)?$/i.test(value)
    ) {
      failures.push(`manual integration evidence ${field} must be passed`)
    }
  }

  return failures
}

export function manualGateCommitFailures(
  contents: string,
  context: ManualGateCommitContext,
): string[] {
  const evidence = contents.match(/## Evidence\s+([\s\S]*?)(?=\n## |\s*$)/)?.[1] ?? ""
  const testedCommit = evidenceValue(evidence, "Commit SHA")
  if (!testedCommit || !fullCommitPattern.test(testedCommit)) return []

  if (!fullCommitPattern.test(context.currentCommit)) {
    return ["manual integration gate current commit must be a full 40-character hexadecimal commit"]
  }
  if (testedCommit.toLowerCase() === context.currentCommit.toLowerCase()) return []
  if (!context.testedCommitIsAncestor) {
    return [
      "manual integration evidence Commit SHA must be the current commit or an ancestor of it",
    ]
  }
  if (
    context.changedFiles.length !== 1 ||
    context.changedFiles[0] !== manualGatePath
  ) {
    return [
      `changes after the tested Commit SHA must contain only ${manualGatePath}`,
    ]
  }
  return []
}

async function main(): Promise<void> {
  const contents = await readFile(manualGatePath, "utf8")
  const failures = manualGateFailures(contents)
  const evidence = contents.match(/## Evidence\s+([\s\S]*?)(?=\n## |\s*$)/)?.[1] ?? ""
  const testedCommit = evidenceValue(evidence, "Commit SHA")
  if (testedCommit && fullCommitPattern.test(testedCommit)) {
    try {
      const currentCommit = resolveCurrentCommit()
      const testedCommitIsAncestor =
        testedCommit.toLowerCase() === currentCommit.toLowerCase() ||
        gitIsAncestor(testedCommit, currentCommit)
      const changedFiles =
        testedCommitIsAncestor && testedCommit.toLowerCase() !== currentCommit.toLowerCase()
          ? gitOutput([
              "diff",
              "--name-only",
              "--no-renames",
              testedCommit,
              currentCommit,
              "--",
            ]).split("\n").filter(Boolean)
          : []
      failures.push(
        ...manualGateCommitFailures(contents, {
          currentCommit,
          testedCommitIsAncestor,
          changedFiles,
        }),
      )
    } catch (error) {
      failures.push(
        `manual integration gate could not validate Commit SHA ancestry: ${errorMessage(error)}`,
      )
    }
  }
  if (failures.length > 0) {
    for (const failure of failures) console.error(`manual gate check failed: ${failure}`)
    process.exit(1)
  }
  console.log("manual integration gate passed with complete checklist and evidence")
}

function evidenceValue(evidence: string, field: string): string | undefined {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return evidence.match(new RegExp(`^- ${escaped}:\\s*(.+)$`, "mi"))?.[1]?.trim()
}

function isRecordedEvidence(value: string | undefined): value is string {
  return Boolean(value && !/^(?:tbd|todo|not run|not recorded|n\/a|-+)$/i.test(value))
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
}

function resolveCurrentCommit(): string {
  const githubSha = process.env.GITHUB_SHA?.trim()
  if (githubSha && !fullCommitPattern.test(githubSha)) {
    throw new Error("GITHUB_SHA is not a full 40-character hexadecimal commit")
  }
  const currentCommit = githubSha ?? gitOutput(["rev-parse", "HEAD"])
  const resolvedCommit = gitOutput(["rev-parse", "--verify", `${currentCommit}^{commit}`])
  if (resolvedCommit.toLowerCase() !== currentCommit.toLowerCase()) {
    throw new Error(`current commit ${currentCommit} does not resolve to itself`)
  }
  return resolvedCommit
}

function gitIsAncestor(ancestor: string, descendant: string): boolean {
  const result = spawnSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
    encoding: "utf8",
  })
  if (result.status === 0) return true
  if (result.status === 1) return false
  throw new Error(result.stderr.trim() || `git merge-base exited with ${result.status ?? "no status"}`)
}

function gitOutput(args: string[]): string {
  const result = spawnSync("git", args, { encoding: "utf8" })
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ${args[0]} exited with ${result.status ?? "no status"}`)
  }
  return result.stdout.trim()
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

if (import.meta.main) await main()
