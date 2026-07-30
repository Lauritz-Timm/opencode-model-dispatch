const GITHUB_API_ROOT = "https://api.github.com"
const GITHUB_API_VERSION = "2026-03-10"
const REPOSITORY_SLUG_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/i

export interface ReleaseCiWorkflowRun {
  id: number
  run_attempt: number
  head_sha: string
  event: string
  status: string
  conclusion: string | null
}

export interface ReleaseCiCheckResult {
  failures: string[]
  run?: ReleaseCiWorkflowRun
}

export interface CheckReleaseCiOptions {
  repository: string
  expectedSha: string
  token: string
  fetchImpl?: typeof fetch
}

interface WorkflowRunsResponse {
  workflow_runs: ReleaseCiWorkflowRun[]
}

export function releaseCiResult(
  expectedSha: string,
  runs: readonly ReleaseCiWorkflowRun[],
): ReleaseCiCheckResult {
  if (!COMMIT_SHA_PATTERN.test(expectedSha)) {
    return {
      failures: [
        "GITHUB_SHA must be a full 40-character hexadecimal release commit",
      ],
    }
  }

  const exactPushRuns = runs
    .filter((run) => run.head_sha.toLowerCase() === expectedSha.toLowerCase())
    .filter((run) => run.event === "push")
    .sort(compareWorkflowRunsNewestFirst)
  const latest = exactPushRuns[0]

  if (latest?.status !== "completed" || latest.conclusion !== "success") {
    return {
      failures: [
        `GitHub ci.yml must have a successful completed push run for release commit ${expectedSha}`,
      ],
    }
  }

  return { failures: [], run: latest }
}

export async function checkReleaseCi(
  options: CheckReleaseCiOptions,
): Promise<ReleaseCiCheckResult> {
  const inputFailures: string[] = []
  if (!REPOSITORY_SLUG_PATTERN.test(options.repository)) {
    inputFailures.push(
      "GITHUB_REPOSITORY must have the form owner/repository",
    )
  }
  if (!COMMIT_SHA_PATTERN.test(options.expectedSha)) {
    inputFailures.push(
      "GITHUB_SHA must be a full 40-character hexadecimal release commit",
    )
  }
  if (options.token.length === 0 || options.token.trim() !== options.token) {
    inputFailures.push(
      "GITHUB_TOKEN must be a nonempty token without surrounding whitespace",
    )
  }
  if (inputFailures.length > 0) return { failures: inputFailures }

  const workflowRunsUrl = new URL(
    `/repos/${options.repository}/actions/workflows/ci.yml/runs`,
    GITHUB_API_ROOT,
  )
  workflowRunsUrl.searchParams.set("head_sha", options.expectedSha)
  workflowRunsUrl.searchParams.set("event", "push")
  workflowRunsUrl.searchParams.set("per_page", "100")

  let response: Response
  try {
    response = await (options.fetchImpl ?? fetch)(workflowRunsUrl, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${options.token}`,
        "User-Agent": "opencode-model-dispatch-release-check",
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
      },
      redirect: "error",
    })
  } catch (error) {
    return {
      failures: [
        `GitHub ci.yml workflow runs could not be verified: ${errorMessage(error)}`,
      ],
    }
  }

  if (!response.ok) {
    return {
      failures: [
        `GitHub ci.yml workflow runs could not be verified: API returned HTTP ${response.status}`,
      ],
    }
  }

  let value: unknown
  try {
    value = await response.json()
  } catch {
    return {
      failures: [
        "GitHub ci.yml workflow runs could not be verified: API returned invalid JSON",
      ],
    }
  }
  if (!isWorkflowRunsResponse(value)) {
    return {
      failures: [
        "GitHub ci.yml workflow runs could not be verified: API returned an invalid response",
      ],
    }
  }

  return releaseCiResult(options.expectedSha, value.workflow_runs)
}

function compareWorkflowRunsNewestFirst(
  left: ReleaseCiWorkflowRun,
  right: ReleaseCiWorkflowRun,
): number {
  const idDifference = right.id - left.id
  if (idDifference !== 0) return idDifference
  return right.run_attempt - left.run_attempt
}

function isWorkflowRunsResponse(value: unknown): value is WorkflowRunsResponse {
  return isRecord(value)
    && Array.isArray(value.workflow_runs)
    && value.workflow_runs.every(isWorkflowRun)
}

function isWorkflowRun(value: unknown): value is ReleaseCiWorkflowRun {
  return isRecord(value)
    && Number.isSafeInteger(value.id)
    && Number(value.id) > 0
    && Number.isSafeInteger(value.run_attempt)
    && Number(value.run_attempt) > 0
    && typeof value.head_sha === "string"
    && typeof value.event === "string"
    && typeof value.status === "string"
    && (typeof value.conclusion === "string" || value.conclusion === null)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function main(): Promise<void> {
  const expectedSha = process.env.GITHUB_SHA ?? ""
  const result = await checkReleaseCi({
    repository: process.env.GITHUB_REPOSITORY ?? "",
    expectedSha,
    token: process.env.GITHUB_TOKEN ?? "",
  })

  if (result.failures.length > 0) {
    for (const failure of result.failures) {
      console.error(`release CI check failed: ${failure}`)
    }
    process.exit(1)
  }

  console.log(
    `release CI check passed: ci.yml push run ${result.run?.id} completed successfully for ${expectedSha}`,
  )
}

if (import.meta.main) {
  try {
    await main()
  } catch (error) {
    console.error(
      `release CI check failed: ${errorMessage(error)}`,
    )
    process.exit(1)
  }
}
