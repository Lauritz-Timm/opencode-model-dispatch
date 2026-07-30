import { describe, expect, test } from "bun:test"

import {
  checkReleaseCi,
  releaseCiResult,
  type ReleaseCiWorkflowRun,
} from "../scripts/check-release-ci"

const releaseSha = "a".repeat(40)
const staleSha = "b".repeat(40)

function workflowRun(
  overrides: Partial<ReleaseCiWorkflowRun> = {},
): ReleaseCiWorkflowRun {
  return {
    id: 10,
    run_attempt: 1,
    head_sha: releaseSha,
    event: "push",
    status: "completed",
    conclusion: "success",
    ...overrides,
  }
}

describe("tagged release exact-SHA CI gate", () => {
  test("accepts the newest successful completed push run for the exact SHA", () => {
    expect(releaseCiResult(releaseSha, [
      workflowRun({ id: 9, conclusion: "failure" }),
      workflowRun({ id: 10 }),
      workflowRun({ id: 11, head_sha: staleSha }),
      workflowRun({ id: 12, event: "pull_request" }),
    ])).toEqual({
      failures: [],
      run: workflowRun({ id: 10 }),
    })
  })

  test("fails closed when the newest exact-SHA push run is unsuccessful or incomplete", () => {
    const expectedFailure =
      `GitHub ci.yml must have a successful completed push run for release commit ${releaseSha}`

    expect(releaseCiResult(releaseSha, [
      workflowRun(),
      workflowRun({ id: 11, conclusion: "failure" }),
    ]).failures).toContain(expectedFailure)
    expect(releaseCiResult(releaseSha, [
      workflowRun({ status: "queued", conclusion: null }),
    ]).failures).toContain(expectedFailure)
    expect(releaseCiResult(releaseSha, [
      workflowRun({ head_sha: staleSha }),
    ]).failures).toContain(expectedFailure)
  })

  test("rejects malformed release SHAs before considering workflow runs", () => {
    expect(releaseCiResult("abc123", [workflowRun()]).failures).toEqual([
      "GITHUB_SHA must be a full 40-character hexadecimal release commit",
    ])
  })

  test("queries only ci.yml push runs at the exact SHA with the supplied token", async () => {
    let seenUrl = ""
    let seenInit: RequestInit | undefined
    const result = await checkReleaseCi({
      repository: "Lauritz-Timm/opencode-model-dispatch",
      expectedSha: releaseSha,
      token: "read-only-actions-token",
      fetchImpl: (async (input, init) => {
        seenUrl = String(input)
        seenInit = init
        return Response.json({ workflow_runs: [workflowRun()] })
      }) as typeof fetch,
    })

    expect(result.failures).toEqual([])
    expect(seenUrl).toBe(
      "https://api.github.com/repos/Lauritz-Timm/opencode-model-dispatch/actions/workflows/ci.yml/runs"
      + `?head_sha=${releaseSha}&event=push&per_page=100`,
    )
    expect(seenInit?.headers).toMatchObject({
      Authorization: "Bearer read-only-actions-token",
    })
    expect(seenInit?.redirect).toBe("error")
  })

  test("fails closed for missing inputs, API failures, and malformed responses", async () => {
    expect((await checkReleaseCi({
      repository: "",
      expectedSha: "abc123",
      token: "",
      fetchImpl: (() => {
        throw new Error("must not fetch")
      }) as typeof fetch,
    })).failures).toEqual([
      "GITHUB_REPOSITORY must have the form owner/repository",
      "GITHUB_SHA must be a full 40-character hexadecimal release commit",
      "GITHUB_TOKEN must be a nonempty token without surrounding whitespace",
    ])

    expect((await checkReleaseCi({
      repository: "owner/repository",
      expectedSha: releaseSha,
      token: "token",
      fetchImpl: (async () => new Response("forbidden", { status: 403 })) as typeof fetch,
    })).failures).toEqual([
      "GitHub ci.yml workflow runs could not be verified: API returned HTTP 403",
    ])

    expect((await checkReleaseCi({
      repository: "owner/repository",
      expectedSha: releaseSha,
      token: "token",
      fetchImpl: (async () => Response.json({
        workflow_runs: [{ ...workflowRun(), id: "not-a-number" }],
      })) as typeof fetch,
    })).failures).toEqual([
      "GitHub ci.yml workflow runs could not be verified: API returned an invalid response",
    ])
  })
})
