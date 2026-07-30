import { readFileSync } from "node:fs"

const GITHUB_API_ROOT = "https://api.github.com"
const GITHUB_API_VERSION = "2026-03-10"
const REPOSITORY_SLUG_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/i
const RELEASE_TAG_PATTERN = /^v[^/]+$/
const RELEASE_TAG_REF_PATTERN = /^refs\/tags\/v[^/]*$/
const RELEASE_TAG_REF_PREFIX = "refs/tags/v"

export const REQUIRED_CI_CHECK_CONTEXTS = [
  "Dependency audit",
  "Plugin tests",
  "Typecheck",
  "Node 18 package consumer",
  "Node 22 package consumer",
  "Real OpenCode integration",
  "Picker build (Linux x64)",
  "Picker build (Linux ARM64)",
  "Picker build (macOS ARM64)",
  "Picker build (Windows x64)",
  "Picker build (Windows ARM64)",
  "Packaging checks",
] as const
export const GITHUB_ACTIONS_APP_ID = 15368

export interface RepositoryMetadata {
  id: number
  owner?: { id?: number; login?: string }
  private?: boolean
  visibility?: string
  archived?: boolean
  disabled?: boolean
  has_issues?: boolean
  has_wiki?: boolean
  default_branch?: string
  description?: string | null
  topics?: string[]
  license?: { spdx_id?: string } | null
}

export interface PrivateVulnerabilityReporting {
  enabled?: boolean
}

export interface ImmutableReleases {
  enabled?: boolean
  enforced_by_owner?: boolean
}

export interface DependabotSecurityUpdates {
  enabled?: boolean
  paused?: boolean
}

export interface RepositoryRule {
  type?: string
  parameters?: {
    strict_required_status_checks_policy?: boolean
    required_status_checks?: Array<{ context?: string; integration_id?: number }>
    workflows?: Array<{
      path?: string
      repository_id?: number
      ref?: string
      sha?: string
    }>
  }
}

export interface ClassicBranchProtection {
  required_status_checks?: {
    strict?: boolean
    contexts?: string[]
    checks?: Array<{ context?: string; app_id?: number | null }>
  } | null
  allow_force_pushes?: { enabled?: boolean }
  allow_deletions?: { enabled?: boolean }
}

export interface RepositoryRuleset {
  id?: number
  target?: string
  enforcement?: string
  conditions?: {
    ref_name?: {
      include?: string[]
      exclude?: string[]
    }
  }
  bypass_actors?: Array<{
    actor_id?: number | null
    actor_type?: string
    bypass_mode?: string
  }>
  rules?: RepositoryRule[]
}

export interface WorkflowRun {
  id?: number
  run_attempt?: number
  head_sha?: string
  event?: string
  status?: string
  conclusion?: string | null
}

export type Verification<T> =
  | { status: "verified"; value: T }
  | { status: "unavailable"; reason: string }

export interface PublicRepositorySnapshot {
  repository: RepositoryMetadata
  expectedSha: string
  releaseTag: string
  vulnerabilityReporting: Verification<PrivateVulnerabilityReporting>
  immutableReleases: Verification<ImmutableReleases>
  dependabotSecurityUpdates: Verification<DependabotSecurityUpdates>
  mainRules: Verification<RepositoryRule[]>
  classicMainProtection: Verification<ClassicBranchProtection>
  releaseTagRulesets: Verification<RepositoryRuleset[]>
  ciRuns: Verification<WorkflowRun[]>
}

export interface PublicRepositoryReadiness {
  failures: string[]
  warnings: string[]
}

export interface CollectPublicRepositoryOptions {
  slug: string
  expectedSha: string
  releaseTag: string
  token?: string
  settingsToken?: string
  fetchImpl?: typeof fetch
}

interface RulesetSummary {
  id?: number
  target?: string
  enforcement?: string
}

interface WorkflowRunsResponse {
  workflow_runs?: WorkflowRun[]
}

interface ApiContext {
  fetchImpl: typeof fetch
  headers: Record<string, string>
  slug: string
}

export function verified<T>(value: T): Verification<T> {
  return { status: "verified", value }
}

export function unavailable<T>(reason: string): Verification<T> {
  return { status: "unavailable", reason }
}

export function publicRepositoryReadiness(
  snapshot: PublicRepositorySnapshot,
): PublicRepositoryReadiness {
  const failures: string[] = []
  const warnings: string[] = []
  const { repository } = snapshot

  if (repository.private !== false || repository.visibility !== "public") {
    failures.push("GitHub repository must be public")
  }
  if (repository.archived || repository.disabled) {
    failures.push("GitHub repository must be active")
  }
  if (!repository.has_issues) {
    failures.push("GitHub Issues must be enabled")
  }
  if (repository.license?.spdx_id !== "MIT") {
    failures.push("GitHub must detect the repository MIT license")
  }
  if (repository.default_branch !== "main") {
    failures.push("GitHub default branch must be main")
  }

  requireEnabledVerification(
    snapshot.vulnerabilityReporting,
    "GitHub private vulnerability reporting",
    failures,
  )
  requireEnabledVerification(
    snapshot.immutableReleases,
    "GitHub immutable releases",
    failures,
  )
  requireDependabotSecurityUpdates(snapshot.dependabotSecurityUpdates, failures)
  requireMainProtection(
    snapshot.mainRules,
    snapshot.classicMainProtection,
    repository.id,
    snapshot.expectedSha,
    failures,
  )
  requireReleaseTagProtection(
    snapshot.releaseTagRulesets,
    snapshot.releaseTag,
    repository.owner?.id,
    failures,
  )
  requireSuccessfulCi(snapshot.ciRuns, snapshot.expectedSha, failures)

  if (!repository.description?.trim()) {
    warnings.push("GitHub repository description is empty")
  }
  const topics = new Set(repository.topics ?? [])
  for (const topic of ["opencode", "opencode-plugin", "tauri"]) {
    if (!topics.has(topic)) warnings.push(`GitHub repository topic is missing: ${topic}`)
  }
  if (repository.has_wiki) {
    warnings.push("GitHub wiki is enabled; disable it if the repository does not use it")
  }

  return { failures, warnings }
}

export async function collectPublicRepositorySnapshot(
  options: CollectPublicRepositoryOptions,
): Promise<PublicRepositorySnapshot> {
  const { slug, expectedSha, releaseTag } = options
  if (!REPOSITORY_SLUG_PATTERN.test(slug)) {
    throw new Error(`Invalid GitHub repository slug: ${slug}`)
  }

  const fetchImpl = options.fetchImpl ?? fetch
  const publicContext = apiContext(slug, fetchImpl, options.token)
  const settingsContext = apiContext(
    slug,
    fetchImpl,
    options.settingsToken ?? options.token,
  )
  const repository = await getRequiredJson<RepositoryMetadata>(
    publicContext,
    `/repos/${slug}`,
    isRepositoryMetadata,
  )

  const [
    vulnerabilityReporting,
    immutableReleases,
    dependabotSecurityUpdates,
    mainRules,
    classicMainProtection,
    releaseTagRulesets,
    ciRuns,
  ] = await Promise.all([
    getVerifiedJson(
      settingsContext,
      `/repos/${slug}/private-vulnerability-reporting`,
      "private vulnerability reporting",
      isPrivateVulnerabilityReporting,
    ),
    getVerifiedJson(
      settingsContext,
      `/repos/${slug}/immutable-releases`,
      "immutable releases",
      isImmutableReleases,
    ),
    getVerifiedJson(
      settingsContext,
      `/repos/${slug}/automated-security-fixes`,
      "Dependabot security updates",
      isDependabotSecurityUpdates,
    ),
    getVerifiedArray(
      settingsContext,
      `/repos/${slug}/rules/branches/main?per_page=100`,
      "effective main branch rules",
      isRepositoryRule,
    ),
    getVerifiedJson(
      settingsContext,
      `/repos/${slug}/branches/main/protection`,
      "classic main branch protection",
      isClassicBranchProtection,
    ),
    getReleaseTagRulesets(settingsContext),
    getWorkflowRuns(publicContext, expectedSha),
  ])

  return {
    repository,
    expectedSha,
    releaseTag,
    vulnerabilityReporting,
    immutableReleases,
    dependabotSecurityUpdates,
    mainRules,
    classicMainProtection,
    releaseTagRulesets,
    ciRuns,
  }
}

function requireEnabledVerification(
  verification: Verification<{ enabled?: boolean }>,
  label: string,
  failures: string[],
): void {
  if (verification.status === "unavailable") {
    failures.push(`${label} could not be verified: ${verification.reason}`)
  } else if (verification.value.enabled !== true) {
    failures.push(`${label} must be enabled`)
  }
}

function requireDependabotSecurityUpdates(
  verification: Verification<DependabotSecurityUpdates>,
  failures: string[],
): void {
  const label = "GitHub Dependabot security updates"
  if (verification.status === "unavailable") {
    failures.push(`${label} could not be verified: ${verification.reason}`)
    return
  }
  if (verification.value.enabled !== true) {
    failures.push(`${label} must be enabled`)
  } else if (verification.value.paused !== false) {
    failures.push(`${label} must not be paused`)
  }
}

function requireMainProtection(
  rulesVerification: Verification<RepositoryRule[]>,
  classicVerification: Verification<ClassicBranchProtection>,
  repositoryId: number,
  expectedSha: string,
  failures: string[],
): void {
  const rules = rulesVerification.status === "verified" ? rulesVerification.value : []
  const types = new Set(rules.map((rule) => rule.type))
  const classic = classicVerification.status === "verified"
    ? classicVerification.value
    : undefined

  const blocksDeletion = types.has("deletion")
    || classic?.allow_deletions?.enabled === false
  const blocksForcePushes = types.has("non_fast_forward")
    || classic?.allow_force_pushes?.enabled === false
  const requiresCi = rules.some((rule) =>
    requiresCompleteCi(rule, repositoryId, expectedSha)
  )
    || classicRequiresCompleteCi(classic)

  if (!blocksDeletion) {
    failures.push("GitHub main branch must block deletion")
  }
  if (!blocksForcePushes) {
    failures.push("GitHub main branch must block force pushes")
  }
  if (!requiresCi) {
    failures.push(
      "GitHub main branch must require the complete CI workflow with strict up-to-date checks",
    )
  }

  if (
    (!blocksDeletion || !blocksForcePushes || !requiresCi)
    && rulesVerification.status === "unavailable"
    && classicVerification.status === "unavailable"
  ) {
    failures.push(
      "GitHub main branch protection APIs could not be verified: "
      + `${rulesVerification.reason}; ${classicVerification.reason}`,
    )
  }
}

function requiresCompleteCi(
  rule: RepositoryRule,
  repositoryId: number,
  expectedSha: string,
): boolean {
  if (rule.type === "workflows") {
    return (rule.parameters?.workflows ?? []).some((workflow) =>
      (workflow.path === ".github/workflows/ci.yml" || workflow.path === "ci.yml")
      && workflow.repository_id === repositoryId
      && (workflow.ref === "refs/heads/main" || workflow.ref === "main")
      && (
        workflow.sha === undefined
        || (
          COMMIT_SHA_PATTERN.test(workflow.sha)
          && COMMIT_SHA_PATTERN.test(expectedSha)
          && workflow.sha.toLowerCase() === expectedSha.toLowerCase()
        )
      )
    )
  }
  if (
    rule.type !== "required_status_checks"
    || rule.parameters?.strict_required_status_checks_policy !== true
  ) {
    return false
  }

  const configured = new Set(
    (rule.parameters.required_status_checks ?? [])
      .filter((check) => check.integration_id === GITHUB_ACTIONS_APP_ID)
      .map((check) => check.context)
      .filter((context): context is string => typeof context === "string"),
  )
  return hasAllRequiredCiContexts(configured)
}

function classicRequiresCompleteCi(
  protection: ClassicBranchProtection | undefined,
): boolean {
  if (protection?.required_status_checks?.strict !== true) return false

  const configured = new Set(
    (protection.required_status_checks.checks ?? [])
      .filter((check) => check.app_id === GITHUB_ACTIONS_APP_ID)
      .map((check) => check.context)
      .filter((context): context is string => typeof context === "string"),
  )
  return hasAllRequiredCiContexts(configured)
}

function hasAllRequiredCiContexts(configured: Set<string>): boolean {
  return REQUIRED_CI_CHECK_CONTEXTS.every((required) =>
    configured.has(required)
    || [...configured].some((context) => context.endsWith(` / ${required}`))
  )
}

function requireReleaseTagProtection(
  verification: Verification<RepositoryRuleset[]>,
  releaseTag: string,
  releaseActorId: number | undefined,
  failures: string[],
): void {
  const label = "GitHub release tag protection"
  if (verification.status === "unavailable") {
    failures.push(`${label} could not be verified: ${verification.reason}`)
    return
  }
  if (!RELEASE_TAG_PATTERN.test(releaseTag)) {
    failures.push(`GitHub release tag must match v*: ${releaseTag || "(missing)"}`)
    return
  }

  const namespaceRulesets = verification.value
    .filter((ruleset) => isActiveRuleset(ruleset))
    .filter((ruleset) => ruleset.target === "tag")
    .filter(rulesetProtectsReleaseNamespace)
  if (namespaceRulesets.length === 0) {
    failures.push(
      "GitHub release tag rules must cover the entire refs/tags/v* namespace "
      + "without matching exclusions",
    )
    return
  }

  const applicableRules = namespaceRulesets
    .flatMap((ruleset) => ruleset.rules ?? [])
  const types = new Set(applicableRules.map((rule) => rule.type))

  for (const [type, action] of [
    ["creation", "creation"],
    ["update", "updates"],
    ["deletion", "deletion"],
  ] as const) {
    if (!types.has(type)) {
      failures.push(`GitHub refs/tags/v* rules must restrict ${action}`)
    }
  }

  if (!Number.isSafeInteger(releaseActorId) || (releaseActorId ?? 0) <= 0) {
    failures.push("GitHub repository owner ID must be available for release tag bypass verification")
    return
  }

  const unsafeBypass = namespaceRulesets
    .flatMap((ruleset) => ruleset.bypass_actors ?? [])
    .find((actor) =>
      actor.actor_type !== "User"
      || actor.actor_id !== releaseActorId
      || actor.bypass_mode !== "always"
    )
  if (unsafeBypass) {
    failures.push(
      "GitHub refs/tags/v* bypass must be limited to the repository owner user in always mode",
    )
  }

  const ownerCanCreate = namespaceRulesets
    .filter((ruleset) => (ruleset.rules ?? []).some((rule) => rule.type === "creation"))
    .every((ruleset) =>
      (ruleset.bypass_actors ?? []).some((actor) =>
        actor.actor_type === "User"
        && actor.actor_id === releaseActorId
        && actor.bypass_mode === "always"
      )
    )
  if (!ownerCanCreate) {
    failures.push(
      "GitHub repository owner must be the always-allowed bypass actor on every refs/tags/v* creation rule",
    )
  }
}

function requireSuccessfulCi(
  verification: Verification<WorkflowRun[]>,
  expectedSha: string,
  failures: string[],
): void {
  const label = "GitHub CI status"
  if (!COMMIT_SHA_PATTERN.test(expectedSha)) {
    failures.push(`GitHub release commit SHA must be a full 40-character hexadecimal SHA`)
    return
  }
  if (verification.status === "unavailable") {
    failures.push(`${label} could not be verified: ${verification.reason}`)
    return
  }

  const exactRuns = verification.value
    .filter((run) => run.head_sha?.toLowerCase() === expectedSha.toLowerCase())
    .filter((run) => run.event === "push")
    .sort(compareWorkflowRunsNewestFirst)
  const latest = exactRuns[0]
  if (latest?.status !== "completed" || latest.conclusion !== "success") {
    failures.push(
      `GitHub CI must have a successful completed push run for release commit ${expectedSha}`,
    )
  }
}

function compareWorkflowRunsNewestFirst(left: WorkflowRun, right: WorkflowRun): number {
  const idDifference = (right.id ?? -1) - (left.id ?? -1)
  if (idDifference !== 0) return idDifference
  return (right.run_attempt ?? -1) - (left.run_attempt ?? -1)
}

function isActiveRuleset(ruleset: RepositoryRuleset): boolean {
  return ruleset.enforcement === "active" || ruleset.enforcement === "enabled"
}

function rulesetProtectsReleaseNamespace(ruleset: RepositoryRuleset): boolean {
  const refCondition = ruleset.conditions?.ref_name
  const includes = refCondition?.include ?? []
  const excludes = refCondition?.exclude ?? []
  return includes.some(includePatternCoversReleaseNamespace)
    && !excludes.some(exclusionCouldRemoveReleaseTag)
}

function includePatternCoversReleaseNamespace(pattern: string): boolean {
  return pattern === "~ALL"
    || pattern === "refs/tags/v*"
    || pattern === "refs/tags/*"
    || pattern === "refs/tags/**"
}

function exclusionCouldRemoveReleaseTag(pattern: string): boolean {
  if (pattern === "~ALL") return true
  if (pattern === "~DEFAULT_BRANCH") return false

  const firstWildcard = pattern.search(/[*?\[]/)
  if (firstWildcard === -1) return RELEASE_TAG_REF_PATTERN.test(pattern)

  // If the literal portion before the first wildcard diverges from the release
  // prefix, the pattern is provably disjoint. Treat all uncertain patterns as
  // overlapping so namespace coverage remains fail-closed.
  const literalPrefix = pattern.slice(0, firstWildcard)
  return RELEASE_TAG_REF_PREFIX.startsWith(literalPrefix)
    || literalPrefix.startsWith(RELEASE_TAG_REF_PREFIX)
}

function apiContext(
  slug: string,
  fetchImpl: typeof fetch,
  token?: string,
): ApiContext {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "opencode-model-dispatch-release-check",
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
  }
  if (token) headers.Authorization = `Bearer ${token}`
  return { fetchImpl, headers, slug }
}

async function getRequiredJson<T>(
  context: ApiContext,
  path: string,
  validate: (value: unknown) => value is T,
): Promise<T> {
  const response = await context.fetchImpl(apiUrl(path), { headers: context.headers })
  if (!response.ok) {
    throw new Error(`GitHub API request failed (${response.status}) for ${apiUrl(path)}`)
  }
  const value: unknown = await response.json()
  if (!validate(value)) {
    throw new Error(`GitHub API returned an invalid response for ${apiUrl(path)}`)
  }
  return value
}

async function getVerifiedJson<T>(
  context: ApiContext,
  path: string,
  label: string,
  validate: (value: unknown) => value is T,
): Promise<Verification<T>> {
  try {
    const response = await context.fetchImpl(apiUrl(path), { headers: context.headers })
    if (!response.ok) return unavailable(apiFailureReason(label, response.status))
    const value: unknown = await response.json()
    if (!validate(value)) return unavailable(`${label} endpoint returned an invalid response`)
    return verified(value)
  } catch (error) {
    return unavailable(`${label} request failed: ${errorMessage(error)}`)
  }
}

async function getVerifiedArray<T>(
  context: ApiContext,
  path: string,
  label: string,
  validateItem: (value: unknown) => value is T,
): Promise<Verification<T[]>> {
  try {
    const values = await getPaginatedArray(context, path, label)
    if (values.status === "unavailable") return values
    if (!values.value.every(validateItem)) {
      return unavailable(`${label} endpoint returned an invalid response`)
    }
    return verified(values.value)
  } catch (error) {
    return unavailable(`${label} request failed: ${errorMessage(error)}`)
  }
}

async function getPaginatedArray(
  context: ApiContext,
  initialPath: string,
  label: string,
): Promise<Verification<unknown[]>> {
  const values: unknown[] = []
  let nextUrl: string | undefined = apiUrl(initialPath)

  for (let page = 0; nextUrl && page < 20; page += 1) {
    if (!isSafeApiUrl(nextUrl, context.slug)) {
      return unavailable(`${label} pagination returned an unsafe URL`)
    }
    const response = await context.fetchImpl(nextUrl, { headers: context.headers })
    if (!response.ok) return unavailable(apiFailureReason(label, response.status))
    const pageValue: unknown = await response.json()
    if (!Array.isArray(pageValue)) {
      return unavailable(`${label} endpoint returned an invalid response`)
    }
    values.push(...pageValue)
    nextUrl = nextLink(response.headers.get("link"))
  }

  if (nextUrl) return unavailable(`${label} pagination exceeded 20 pages`)
  return verified(values)
}

async function getReleaseTagRulesets(
  context: ApiContext,
): Promise<Verification<RepositoryRuleset[]>> {
  const summaries = await getVerifiedArray(
    context,
    `/repos/${context.slug}/rulesets?targets=tag&per_page=100`,
    "release tag rulesets",
    isRulesetSummary,
  )
  if (summaries.status === "unavailable") return summaries

  const activeSummaries = summaries.value.filter((summary) =>
    summary.enforcement === "active" || summary.enforcement === "enabled"
  )
  const details = await Promise.all(activeSummaries.map((summary) =>
    typeof summary.id === "number"
      ? getVerifiedRepositoryRuleset(context, summary.id)
      : Promise.resolve(unavailable<RepositoryRuleset>(
          "release tag ruleset summary omitted its id",
        ))
  ))
  const firstUnavailable = details.find((detail) => detail.status === "unavailable")
  if (firstUnavailable?.status === "unavailable") return firstUnavailable
  return verified(details.flatMap((detail) =>
    detail.status === "verified" ? [detail.value] : []
  ))
}

async function getVerifiedRepositoryRuleset(
  context: ApiContext,
  rulesetId: number,
): Promise<Verification<RepositoryRuleset>> {
  const label = `release tag ruleset ${rulesetId}`
  try {
    const response = await context.fetchImpl(
      apiUrl(`/repos/${context.slug}/rulesets/${rulesetId}`),
      { headers: context.headers },
    )
    if (!response.ok) return unavailable(apiFailureReason(label, response.status))
    const value: unknown = await response.json()
    if (isObject(value) && !Array.isArray(value.bypass_actors)) {
      return unavailable(
        `${label} endpoint omitted bypass_actors; GitHub exposes them only `
          + "to a caller with repository Administration read-and-write access",
      )
    }
    if (!isRepositoryRuleset(value)) {
      return unavailable(`${label} endpoint returned an invalid response`)
    }
    return verified(value)
  } catch (error) {
    return unavailable(`${label} request failed: ${errorMessage(error)}`)
  }
}

async function getWorkflowRuns(
  context: ApiContext,
  expectedSha: string,
): Promise<Verification<WorkflowRun[]>> {
  const label = "CI workflow runs"
  const path = `/repos/${context.slug}/actions/workflows/ci.yml/runs`
    + `?head_sha=${encodeURIComponent(expectedSha)}&event=push&per_page=100`
  try {
    const response = await context.fetchImpl(apiUrl(path), { headers: context.headers })
    if (!response.ok) return unavailable(apiFailureReason(label, response.status))
    const value: unknown = await response.json()
    if (!isWorkflowRunsResponse(value)) {
      return unavailable(`${label} endpoint returned an invalid response`)
    }
    return verified(value.workflow_runs ?? [])
  } catch (error) {
    return unavailable(`${label} request failed: ${errorMessage(error)}`)
  }
}

function apiFailureReason(label: string, status: number): string {
  if (status === 401 || status === 403) {
    return `${label} endpoint returned HTTP ${status}; the token cannot verify this setting`
  }
  if (status === 404) {
    return `${label} endpoint returned HTTP 404; disabled and permission-hidden states are ambiguous`
  }
  return `${label} endpoint returned HTTP ${status}`
}

function apiUrl(path: string): string {
  return new URL(path, GITHUB_API_ROOT).toString()
}

function nextLink(linkHeader: string | null): string | undefined {
  if (!linkHeader) return undefined
  for (const entry of linkHeader.split(",")) {
    if (!/;\s*rel="next"\s*$/.test(entry)) continue
    const match = entry.match(/<([^>]+)>/)
    if (match?.[1]) return match[1]
  }
  return undefined
}

function isSafeApiUrl(url: string, slug: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.origin === GITHUB_API_ROOT
      && parsed.pathname.startsWith(`/repos/${slug}/`)
  } catch {
    return false
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isRepositoryMetadata(value: unknown): value is RepositoryMetadata {
  return isObject(value)
    && typeof value.id === "number"
    && isObject(value.owner)
    && typeof value.owner.id === "number"
    && typeof value.owner.login === "string"
}

function isPrivateVulnerabilityReporting(
  value: unknown,
): value is PrivateVulnerabilityReporting {
  return isObject(value) && typeof value.enabled === "boolean"
}

function isImmutableReleases(value: unknown): value is ImmutableReleases {
  return isObject(value) && typeof value.enabled === "boolean"
}

function isDependabotSecurityUpdates(
  value: unknown,
): value is DependabotSecurityUpdates {
  return isObject(value)
    && typeof value.enabled === "boolean"
    && typeof value.paused === "boolean"
}

function isRepositoryRule(value: unknown): value is RepositoryRule {
  return isObject(value) && typeof value.type === "string"
}

function isClassicBranchProtection(value: unknown): value is ClassicBranchProtection {
  if (!isObject(value)) return false
  const statusChecks = value.required_status_checks
  const validStatusChecks = statusChecks === null
    || (
      isObject(statusChecks)
      && typeof statusChecks.strict === "boolean"
      && Array.isArray(statusChecks.contexts)
      && statusChecks.contexts.every((context) => typeof context === "string")
      && (
        statusChecks.checks === undefined
        || (
          Array.isArray(statusChecks.checks)
          && statusChecks.checks.every((check) =>
            isObject(check)
            && typeof check.context === "string"
            && (
              typeof check.app_id === "number"
              || check.app_id === null
              || check.app_id === undefined
            )
          )
        )
      )
    )
  return validStatusChecks
    && isObject(value.allow_force_pushes)
    && typeof value.allow_force_pushes.enabled === "boolean"
    && isObject(value.allow_deletions)
    && typeof value.allow_deletions.enabled === "boolean"
}

function isRulesetSummary(value: unknown): value is RulesetSummary {
  return isObject(value)
    && typeof value.id === "number"
    && typeof value.enforcement === "string"
}

function isRepositoryRuleset(value: unknown): value is RepositoryRuleset {
  return isObject(value)
    && typeof value.id === "number"
    && typeof value.target === "string"
    && typeof value.enforcement === "string"
    && Array.isArray(value.bypass_actors)
    && value.bypass_actors.every((actor) =>
      isObject(actor)
      && (typeof actor.actor_id === "number" || actor.actor_id === null)
      && typeof actor.actor_type === "string"
      && typeof actor.bypass_mode === "string"
    )
    && Array.isArray(value.rules)
}

function isWorkflowRunsResponse(value: unknown): value is WorkflowRunsResponse {
  return isObject(value)
    && Array.isArray(value.workflow_runs)
    && value.workflow_runs.every((run) => isObject(run))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function resolveExpectedSha(): string {
  const environmentSha = process.env.RELEASE_COMMIT_SHA ?? process.env.GITHUB_SHA
  if (environmentSha) return environmentSha

  const result = Bun.spawnSync(["git", "rev-parse", "HEAD"], {
    stdout: "pipe",
    stderr: "pipe",
  })
  if (result.exitCode !== 0) {
    throw new Error(`Could not resolve release commit SHA: ${result.stderr.toString().trim()}`)
  }
  return result.stdout.toString().trim()
}

function resolveReleaseTag(): string {
  const environmentTag = process.env.RELEASE_TAG
    ?? (process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : undefined)
  if (environmentTag) return environmentTag

  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { version?: unknown }
  if (typeof packageJson.version !== "string" || packageJson.version.length === 0) {
    throw new Error("Could not resolve release tag from package.json version")
  }
  return `v${packageJson.version}`
}

async function main(): Promise<void> {
  const slug = process.env.GITHUB_REPOSITORY ?? "Lauritz-Timm/opencode-model-dispatch"
  const expectedSha = resolveExpectedSha()
  const releaseTag = resolveReleaseTag()
  const snapshot = await collectPublicRepositorySnapshot({
    slug,
    expectedSha,
    releaseTag,
    token: process.env.GITHUB_TOKEN,
    settingsToken: process.env.GITHUB_REPOSITORY_SETTINGS_TOKEN,
  })
  const result = publicRepositoryReadiness(snapshot)

  for (const warning of result.warnings) console.warn(`public repository warning: ${warning}`)
  if (result.failures.length > 0) {
    for (const failure of result.failures) console.error(`public repository check failed: ${failure}`)
    process.exit(1)
  }
  console.log(
    `public repository check passed for ${expectedSha}: https://github.com/${slug}`,
  )
}

if (import.meta.main) await main()
