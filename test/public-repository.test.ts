import { describe, expect, test } from "bun:test"

import {
  collectPublicRepositorySnapshot,
  GITHUB_ACTIONS_APP_ID,
  publicRepositoryReadiness,
  REQUIRED_CI_CHECK_CONTEXTS,
  unavailable,
  verified,
  type ClassicBranchProtection,
  type PublicRepositorySnapshot,
  type RepositoryMetadata,
  type RepositoryRule,
  type RepositoryRuleset,
  type WorkflowRun,
} from "../scripts/check-public-repository"

const RELEASE_SHA = "a".repeat(40)
const STALE_SHA = "b".repeat(40)
const RELEASE_TAG = "v0.1.0"
const SLUG = "example/opencode-model-dispatch"
const API_ROOT = `https://api.github.com/repos/${SLUG}`
const REPOSITORY_ID = 42

const repository: RepositoryMetadata = {
  id: REPOSITORY_ID,
  owner: { id: 99, login: "release-owner" },
  private: false,
  visibility: "public",
  archived: false,
  disabled: false,
  has_issues: true,
  has_wiki: false,
  default_branch: "main",
  description: "OpenCode model dispatch plugin",
  topics: ["opencode", "opencode-plugin", "tauri"],
  license: { spdx_id: "MIT" },
}

const completeMainRules: RepositoryRule[] = [
  { type: "deletion" },
  { type: "non_fast_forward" },
  {
    type: "required_status_checks",
    parameters: {
      strict_required_status_checks_policy: true,
      required_status_checks: REQUIRED_CI_CHECK_CONTEXTS.map((context) => ({
        context,
        integration_id: GITHUB_ACTIONS_APP_ID,
      })),
    },
  },
]

const completeClassicMainProtection: ClassicBranchProtection = {
  required_status_checks: {
    strict: true,
    contexts: [...REQUIRED_CI_CHECK_CONTEXTS],
    checks: REQUIRED_CI_CHECK_CONTEXTS.map((context) => ({
      context,
      app_id: GITHUB_ACTIONS_APP_ID,
    })),
  },
  allow_force_pushes: { enabled: false },
  allow_deletions: { enabled: false },
}

const completeTagRuleset: RepositoryRuleset = {
  id: 7,
  target: "tag",
  enforcement: "active",
  conditions: {
    ref_name: {
      include: ["refs/tags/v*"],
      exclude: [],
    },
  },
  bypass_actors: [{
    actor_id: repository.owner!.id,
    actor_type: "User",
    bypass_mode: "always",
  }],
  rules: [
    { type: "creation" },
    { type: "update" },
    { type: "deletion" },
  ],
}

const successfulCiRun: WorkflowRun = {
  id: 11,
  run_attempt: 1,
  head_sha: RELEASE_SHA,
  event: "push",
  status: "completed",
  conclusion: "success",
}

function readySnapshot(
  overrides: Partial<PublicRepositorySnapshot> = {},
): PublicRepositorySnapshot {
  return {
    repository,
    expectedSha: RELEASE_SHA,
    releaseTag: RELEASE_TAG,
    vulnerabilityReporting: verified({ enabled: true }),
    immutableReleases: verified({ enabled: true, enforced_by_owner: false }),
    dependabotSecurityUpdates: verified({ enabled: true, paused: false }),
    mainRules: verified(completeMainRules),
    classicMainProtection: unavailable("classic branch protection is not configured"),
    releaseTagRulesets: verified([completeTagRuleset]),
    ciRuns: verified([successfulCiRun]),
    ...overrides,
  }
}

describe("public repository release gate", () => {
  test("accepts a fully verified release snapshot", () => {
    expect(publicRepositoryReadiness(readySnapshot())).toEqual({
      failures: [],
      warnings: [],
    })
  })

  test("fails unsafe repository settings and keeps metadata polish nonblocking", () => {
    const result = publicRepositoryReadiness(readySnapshot({
      repository: {
        id: REPOSITORY_ID,
        owner: { id: 99, login: "release-owner" },
        private: true,
        visibility: "private",
        archived: true,
        disabled: false,
        has_issues: false,
        has_wiki: true,
        default_branch: "master",
        description: null,
        topics: [],
        license: null,
      },
    }))

    expect(result.failures).toContain("GitHub repository must be public")
    expect(result.failures).toContain("GitHub repository must be active")
    expect(result.failures).toContain("GitHub Issues must be enabled")
    expect(result.failures).toContain("GitHub must detect the repository MIT license")
    expect(result.failures).toContain("GitHub default branch must be main")
    expect(result.warnings).toEqual([
      "GitHub repository description is empty",
      "GitHub repository topic is missing: opencode",
      "GitHub repository topic is missing: opencode-plugin",
      "GitHub repository topic is missing: tauri",
      "GitHub wiki is enabled; disable it if the repository does not use it",
    ])
  })

  test("fails closed when security settings cannot be verified", () => {
    const result = publicRepositoryReadiness(readySnapshot({
      vulnerabilityReporting: unavailable("HTTP 401"),
      immutableReleases: unavailable("HTTP 403"),
      dependabotSecurityUpdates: unavailable("ambiguous HTTP 404"),
    }))

    expect(result.failures).toContain(
      "GitHub private vulnerability reporting could not be verified: HTTP 401",
    )
    expect(result.failures).toContain(
      "GitHub immutable releases could not be verified: HTTP 403",
    )
    expect(result.failures).toContain(
      "GitHub Dependabot security updates could not be verified: ambiguous HTTP 404",
    )
  })

  test("distinguishes disabled and paused security features", () => {
    const disabled = publicRepositoryReadiness(readySnapshot({
      vulnerabilityReporting: verified({ enabled: false }),
      immutableReleases: verified({ enabled: false }),
      dependabotSecurityUpdates: verified({ enabled: false, paused: false }),
    }))
    expect(disabled.failures).toContain(
      "GitHub private vulnerability reporting must be enabled",
    )
    expect(disabled.failures).toContain("GitHub immutable releases must be enabled")
    expect(disabled.failures).toContain(
      "GitHub Dependabot security updates must be enabled",
    )

    const paused = publicRepositoryReadiness(readySnapshot({
      dependabotSecurityUpdates: verified({ enabled: true, paused: true }),
    }))
    expect(paused.failures).toContain(
      "GitHub Dependabot security updates must not be paused",
    )
  })

  test("requires deletion, force-push, and complete strict CI protection on main", () => {
    const result = publicRepositoryReadiness(readySnapshot({
      mainRules: verified([
        {
          type: "required_status_checks",
          parameters: {
            strict_required_status_checks_policy: false,
            required_status_checks: REQUIRED_CI_CHECK_CONTEXTS
              .slice(0, -1)
              .map((context) => ({
                context,
                integration_id: GITHUB_ACTIONS_APP_ID,
              })),
          },
        },
      ]),
    }))

    expect(result.failures).toContain("GitHub main branch must block deletion")
    expect(result.failures).toContain("GitHub main branch must block force pushes")
    expect(result.failures).toContain(
      "GitHub main branch must require the complete CI workflow with strict up-to-date checks",
    )
  })

  test("accepts a required-workflow main rule as complete CI protection", () => {
    const result = publicRepositoryReadiness(readySnapshot({
      mainRules: verified([
        { type: "deletion" },
        { type: "non_fast_forward" },
        {
          type: "workflows",
          parameters: {
            workflows: [{
              path: ".github/workflows/ci.yml",
              repository_id: REPOSITORY_ID,
              ref: "refs/heads/main",
            }],
          },
        },
      ]),
    }))

    expect(result.failures).toEqual([])
  })

  test("rejects a required-workflow rule pinned to a stale workflow commit", () => {
    const rule = (sha: string): RepositoryRule[] => [
      { type: "deletion" },
      { type: "non_fast_forward" },
      {
        type: "workflows",
        parameters: {
          workflows: [{
            path: ".github/workflows/ci.yml",
            repository_id: REPOSITORY_ID,
            ref: "refs/heads/main",
            sha,
          }],
        },
      },
    ]

    expect(publicRepositoryReadiness(readySnapshot({
      mainRules: verified(rule(RELEASE_SHA)),
    })).failures).toEqual([])

    expect(publicRepositoryReadiness(readySnapshot({
      mainRules: verified(rule(STALE_SHA)),
    })).failures).toContain(
      "GitHub main branch must require the complete CI workflow with strict up-to-date checks",
    )
  })

  test("accepts complete classic branch protection when branch rulesets are unavailable", () => {
    const result = publicRepositoryReadiness(readySnapshot({
      mainRules: unavailable("rulesets are not configured"),
      classicMainProtection: verified(completeClassicMainProtection),
    }))

    expect(result.failures).toEqual([])
  })

  test("binds a required-workflow rule to this repository", () => {
    const result = publicRepositoryReadiness(readySnapshot({
      mainRules: verified([
        { type: "deletion" },
        { type: "non_fast_forward" },
        {
          type: "workflows",
          parameters: {
            workflows: [{
              path: ".github/workflows/ci.yml",
              repository_id: REPOSITORY_ID + 1,
              ref: "refs/heads/main",
            }],
          },
        },
      ]),
    }))

    expect(result.failures).toContain(
      "GitHub main branch must require the complete CI workflow with strict up-to-date checks",
    )
  })

  test("layers active matching tag rulesets and requires all tag mutations", () => {
    const splitRulesets: RepositoryRuleset[] = [
      {
        ...completeTagRuleset,
        id: 1,
        rules: [{ type: "creation" }],
      },
      {
        ...completeTagRuleset,
        id: 2,
        rules: [{ type: "update" }, { type: "deletion" }],
      },
      {
        ...completeTagRuleset,
        id: 3,
        enforcement: "disabled",
        rules: [],
      },
    ]
    expect(publicRepositoryReadiness(readySnapshot({
      releaseTagRulesets: verified(splitRulesets),
    })).failures).toEqual([])

    const excluded = publicRepositoryReadiness(readySnapshot({
      releaseTagRulesets: verified([{
        ...completeTagRuleset,
        conditions: {
          ref_name: {
            include: ["~ALL"],
            exclude: ["refs/tags/v2.*"],
          },
        },
      }]),
    }))
    expect(excluded.failures).toContain(
      "GitHub release tag rules must cover the entire refs/tags/v* namespace "
      + "without matching exclusions",
    )
  })

  test("requires a narrow owner-only release tag bypass", () => {
    const broadRole = publicRepositoryReadiness(readySnapshot({
      releaseTagRulesets: verified([{
        ...completeTagRuleset,
        bypass_actors: [{
          actor_id: 5,
          actor_type: "RepositoryRole",
          bypass_mode: "always",
        }],
      }]),
    }))
    expect(broadRole.failures).toContain(
      "GitHub refs/tags/v* bypass must be limited to the repository owner user in always mode",
    )
    expect(broadRole.failures).toContain(
      "GitHub repository owner must be the always-allowed bypass actor on every refs/tags/v* creation rule",
    )

    const wrongMode = publicRepositoryReadiness(readySnapshot({
      releaseTagRulesets: verified([{
        ...completeTagRuleset,
        bypass_actors: [{
          actor_id: repository.owner!.id,
          actor_type: "User",
          bypass_mode: "pull_request",
        }],
      }]),
    }))
    expect(wrongMode.failures).toContain(
      "GitHub refs/tags/v* bypass must be limited to the repository owner user in always mode",
    )
  })

  test("binds required checks to GitHub Actions and required workflows to main", () => {
    const unboundChecks = completeMainRules.map((rule) =>
      rule.type === "required_status_checks"
        ? {
            ...rule,
            parameters: {
              ...rule.parameters,
              required_status_checks: REQUIRED_CI_CHECK_CONTEXTS.map((context) => ({
                context,
              })),
            },
          }
        : rule
    )
    expect(publicRepositoryReadiness(readySnapshot({
      mainRules: verified(unboundChecks),
    })).failures).toContain(
      "GitHub main branch must require the complete CI workflow with strict up-to-date checks",
    )

    expect(publicRepositoryReadiness(readySnapshot({
      mainRules: verified([
        { type: "deletion" },
        { type: "non_fast_forward" },
        {
          type: "workflows",
          parameters: {
            workflows: [{
              path: ".github/workflows/ci.yml",
              repository_id: REPOSITORY_ID,
              ref: "refs/heads/feature",
            }],
          },
        },
      ]),
    })).failures).toContain(
      "GitHub main branch must require the complete CI workflow with strict up-to-date checks",
    )
  })

  test("rejects a ruleset that protects only the current release tag", () => {
    const result = publicRepositoryReadiness(readySnapshot({
      releaseTagRulesets: verified([{
        ...completeTagRuleset,
        conditions: {
          ref_name: {
            include: [`refs/tags/${RELEASE_TAG}`],
            exclude: [],
          },
        },
      }]),
    }))

    expect(result.failures).toContain(
      "GitHub release tag rules must cover the entire refs/tags/v* namespace "
      + "without matching exclusions",
    )
  })

  test("accepts all-tag protection when exclusions are outside the release namespace", () => {
    const result = publicRepositoryReadiness(readySnapshot({
      releaseTagRulesets: verified([{
        ...completeTagRuleset,
        conditions: {
          ref_name: {
            include: ["~ALL"],
            exclude: ["refs/tags/beta*"],
          },
        },
      }]),
    }))

    expect(result.failures).toEqual([])
  })

  test("requires a valid v* release tag", () => {
    const result = publicRepositoryReadiness(readySnapshot({ releaseTag: "release-0.1.0" }))
    expect(result.failures).toContain(
      "GitHub release tag must match v*: release-0.1.0",
    )
  })

  test("requires the newest exact-SHA push CI run to complete successfully", () => {
    const staleOnly = publicRepositoryReadiness(readySnapshot({
      ciRuns: verified([{ ...successfulCiRun, head_sha: STALE_SHA }]),
    }))
    expect(staleOnly.failures).toContain(
      `GitHub CI must have a successful completed push run for release commit ${RELEASE_SHA}`,
    )

    const newestFailed = publicRepositoryReadiness(readySnapshot({
      ciRuns: verified([
        successfulCiRun,
        {
          ...successfulCiRun,
          id: 12,
          run_attempt: 2,
          conclusion: "failure",
        },
      ]),
    }))
    expect(newestFailed.failures).toContain(
      `GitHub CI must have a successful completed push run for release commit ${RELEASE_SHA}`,
    )

    const queued = publicRepositoryReadiness(readySnapshot({
      ciRuns: verified([{
        ...successfulCiRun,
        status: "queued",
        conclusion: null,
      }]),
    }))
    expect(queued.failures).toContain(
      `GitHub CI must have a successful completed push run for release commit ${RELEASE_SHA}`,
    )
  })

  test("fails CI verification before trusting a malformed release SHA", () => {
    const result = publicRepositoryReadiness(readySnapshot({
      expectedSha: "abc123",
      ciRuns: unavailable("should not mask malformed SHA"),
    }))
    expect(result.failures).toContain(
      "GitHub release commit SHA must be a full 40-character hexadecimal SHA",
    )
    expect(result.failures).not.toContain(
      "GitHub CI status could not be verified: should not mask malformed SHA",
    )
  })
})

describe("GitHub readiness snapshot collection", () => {
  test("collects a complete snapshot without contacting the real GitHub API", async () => {
    const seenAuthorization = new Map<string, string | null>()
    const snapshot = await collectPublicRepositorySnapshot({
      slug: SLUG,
      expectedSha: RELEASE_SHA,
      releaseTag: RELEASE_TAG,
      token: "public-token",
      settingsToken: "settings-token",
      fetchImpl: fixtureFetch(happyRoutes(), seenAuthorization),
    })

    expect(publicRepositoryReadiness(snapshot)).toEqual({ failures: [], warnings: [] })
    expect(seenAuthorization.get(`${API_ROOT}/private-vulnerability-reporting`))
      .toBe("Bearer settings-token")
    expect(seenAuthorization.get(`${API_ROOT}/immutable-releases`))
      .toBe("Bearer settings-token")
    expect(seenAuthorization.get(`${API_ROOT}/automated-security-fixes`))
      .toBe("Bearer settings-token")
    expect(seenAuthorization.get(`${API_ROOT}/branches/main/protection`))
      .toBe("Bearer settings-token")
  })

  test("treats 401, 403, and ambiguous 404 responses as unavailable", async () => {
    const routes = happyRoutes()
    routes[`${API_ROOT}/private-vulnerability-reporting`] = {
      status: 401,
      body: { message: "Bad credentials" },
    }
    routes[`${API_ROOT}/immutable-releases`] = {
      status: 403,
      body: { message: "Resource not accessible by integration" },
    }
    routes[`${API_ROOT}/automated-security-fixes`] = {
      status: 404,
      body: { message: "Not Found" },
    }

    const snapshot = await collectPublicRepositorySnapshot({
      slug: SLUG,
      expectedSha: RELEASE_SHA,
      releaseTag: RELEASE_TAG,
      fetchImpl: fixtureFetch(routes),
    })

    expect(snapshot.vulnerabilityReporting).toEqual({
      status: "unavailable",
      reason:
        "private vulnerability reporting endpoint returned HTTP 401; "
        + "the token cannot verify this setting",
    })
    expect(snapshot.immutableReleases).toEqual({
      status: "unavailable",
      reason:
        "immutable releases endpoint returned HTTP 403; "
        + "the token cannot verify this setting",
    })
    expect(snapshot.dependabotSecurityUpdates).toEqual({
      status: "unavailable",
      reason:
        "Dependabot security updates endpoint returned HTTP 404; "
        + "disabled and permission-hidden states are ambiguous",
    })

    const result = publicRepositoryReadiness(snapshot)
    expect(result.failures.some((failure) =>
      failure.startsWith("GitHub private vulnerability reporting could not be verified:")
    )).toBe(true)
    expect(result.failures.some((failure) =>
      failure.startsWith("GitHub immutable releases could not be verified:")
    )).toBe(true)
    expect(result.failures.some((failure) =>
      failure.startsWith("GitHub Dependabot security updates could not be verified:")
    )).toBe(true)
  })

  test("also fails closed when ruleset or exact-SHA CI APIs are permission-hidden", async () => {
    const routes = happyRoutes()
    routes[`${API_ROOT}/rules/branches/main?per_page=100`] = {
      status: 403,
      body: { message: "Resource not accessible by integration" },
    }
    routes[`${API_ROOT}/branches/main/protection`] = {
      status: 403,
      body: { message: "Resource not accessible by integration" },
    }
    routes[`${API_ROOT}/rulesets?targets=tag&per_page=100`] = {
      status: 404,
      body: { message: "Not Found" },
    }
    routes[
      `${API_ROOT}/actions/workflows/ci.yml/runs`
      + `?head_sha=${RELEASE_SHA}&event=push&per_page=100`
    ] = {
      status: 401,
      body: { message: "Bad credentials" },
    }

    const snapshot = await collectPublicRepositorySnapshot({
      slug: SLUG,
      expectedSha: RELEASE_SHA,
      releaseTag: RELEASE_TAG,
      fetchImpl: fixtureFetch(routes),
    })

    expect(snapshot.mainRules.status).toBe("unavailable")
    expect(snapshot.classicMainProtection.status).toBe("unavailable")
    expect(snapshot.releaseTagRulesets.status).toBe("unavailable")
    expect(snapshot.ciRuns.status).toBe("unavailable")

    const result = publicRepositoryReadiness(snapshot)
    expect(result.failures.some((failure) =>
      failure.startsWith("GitHub main branch protection APIs could not be verified:")
    )).toBe(true)
    expect(result.failures.some((failure) =>
      failure.startsWith("GitHub release tag protection could not be verified:")
    )).toBe(true)
    expect(result.failures.some((failure) =>
      failure.startsWith("GitHub CI status could not be verified:")
    )).toBe(true)
  })

  test("explains the write-capability requirement when GitHub hides ruleset bypass actors", async () => {
    const routes = happyRoutes()
    const { bypass_actors: _hidden, ...rulesetWithoutBypassActors } =
      completeTagRuleset
    routes[`${API_ROOT}/rulesets/7`] = {
      body: rulesetWithoutBypassActors,
    }

    const snapshot = await collectPublicRepositorySnapshot({
      slug: SLUG,
      expectedSha: RELEASE_SHA,
      releaseTag: RELEASE_TAG,
      settingsToken: "read-only-settings-token",
      fetchImpl: fixtureFetch(routes),
    })

    expect(snapshot.releaseTagRulesets).toEqual({
      status: "unavailable",
      reason:
        "release tag ruleset 7 endpoint omitted bypass_actors; GitHub exposes "
        + "them only to a caller with repository Administration read-and-write access",
    })
  })

  test("fails closed on malformed API payloads and unsafe pagination links", async () => {
    const malformed = happyRoutes()
    malformed[`${API_ROOT}/automated-security-fixes`] = {
      body: { enabled: true },
    }
    malformed[`${API_ROOT}/rules/branches/main?per_page=100`] = {
      body: completeMainRules,
      headers: {
        Link: '<https://attacker.example/next>; rel="next"',
      },
    }

    const snapshot = await collectPublicRepositorySnapshot({
      slug: SLUG,
      expectedSha: RELEASE_SHA,
      releaseTag: RELEASE_TAG,
      fetchImpl: fixtureFetch(malformed),
    })

    expect(snapshot.dependabotSecurityUpdates.status).toBe("unavailable")
    expect(snapshot.mainRules).toEqual({
      status: "unavailable",
      reason: "effective main branch rules pagination returned an unsafe URL",
    })
  })
})

interface FixtureResponse {
  status?: number
  body: unknown
  headers?: Record<string, string>
}

function happyRoutes(): Record<string, FixtureResponse> {
  return {
    [API_ROOT]: { body: repository },
    [`${API_ROOT}/private-vulnerability-reporting`]: {
      body: { enabled: true },
    },
    [`${API_ROOT}/immutable-releases`]: {
      body: { enabled: true, enforced_by_owner: false },
    },
    [`${API_ROOT}/automated-security-fixes`]: {
      body: { enabled: true, paused: false },
    },
    [`${API_ROOT}/rules/branches/main?per_page=100`]: {
      body: completeMainRules,
    },
    [`${API_ROOT}/branches/main/protection`]: {
      body: completeClassicMainProtection,
    },
    [`${API_ROOT}/rulesets?targets=tag&per_page=100`]: {
      body: [{ id: 7, target: "tag", enforcement: "active" }],
    },
    [`${API_ROOT}/rulesets/7`]: {
      body: completeTagRuleset,
    },
    [
      `${API_ROOT}/actions/workflows/ci.yml/runs`
      + `?head_sha=${RELEASE_SHA}&event=push&per_page=100`
    ]: {
      body: { workflow_runs: [successfulCiRun] },
    },
  }
}

function fixtureFetch(
  routes: Record<string, FixtureResponse>,
  seenAuthorization?: Map<string, string | null>,
): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input)
    const headers = new Headers(init?.headers)
    seenAuthorization?.set(url, headers.get("authorization"))
    const fixture = routes[url]
    if (!fixture) {
      return Response.json(
        { message: `Unexpected fixture URL: ${url}` },
        { status: 500 },
      )
    }
    return Response.json(fixture.body, {
      status: fixture.status ?? 200,
      headers: fixture.headers,
    })
  }) as typeof fetch
}
