import { Buffer } from "node:buffer"
import { readFile } from "node:fs/promises"

const statementType = "https://in-toto.io/Statement/v1"
const predicateType = "https://slsa.dev/provenance/v1"
const githubWorkflowBuildType =
  "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1"
const githubHostedBuilder =
  "https://github.com/actions/runner/github-hosted"
const npmRegistry = "https://registry.npmjs.org/"

export interface ExpectedNpmProvenance {
  packageName: string
  packageVersion: string
  integrity: string
  repository: string
  workflowPath: string
  ref: string
  commit: string
}

type JsonRecord = Record<string, unknown>

export function npmProvenanceFailures(
  audit: unknown,
  expected: ExpectedNpmProvenance,
): string[] {
  const failures: string[] = []
  const auditRecord = record(audit)
  if (!auditRecord) {
    return ["npm audit signatures output must be a JSON object"]
  }

  requireEmptyArray(failures, auditRecord, "invalid")
  requireEmptyArray(failures, auditRecord, "missing")

  const verified = array(auditRecord.verified)
  if (!verified) {
    failures.push(
      "npm audit signatures output must contain a verified array; run with --json --include-attestations",
    )
    return failures
  }

  const packageEntries = verified
    .map(record)
    .filter(
      (entry): entry is JsonRecord =>
        entry?.name === expected.packageName &&
        entry.version === expected.packageVersion,
    )
  if (packageEntries.length !== 1) {
    failures.push(
      `npm audit signatures must verify exactly one ${expected.packageName}@${expected.packageVersion} entry; found ${packageEntries.length}`,
    )
    return failures
  }

  const packageEntry = packageEntries[0]!
  if (packageEntry.registry !== npmRegistry) {
    failures.push(
      `verified package registry must equal ${npmRegistry}; received ${display(packageEntry.registry)}`,
    )
  }
  if (!record(packageEntry.attestations)) {
    failures.push("verified package must expose registry attestation metadata")
  }

  const bundles = array(packageEntry.attestationBundles)
  if (!bundles) {
    failures.push(
      "verified package must include full attestation bundles from npm audit signatures",
    )
    return failures
  }
  const provenanceBundles = bundles
    .map(record)
    .filter((bundle): bundle is JsonRecord => bundle?.predicateType === predicateType)
  if (provenanceBundles.length !== 1) {
    failures.push(
      `verified package must contain exactly one ${predicateType} attestation; found ${provenanceBundles.length}`,
    )
    return failures
  }

  const provenance = provenanceBundles[0]!
  const sigstoreBundle = record(provenance.bundle)
  if (!sigstoreBundle) {
    failures.push(
      "verified provenance must include the cryptographically checked Sigstore bundle",
    )
    return failures
  }
  const decodedStatement = decodeDsseStatement(sigstoreBundle)
  if (decodedStatement instanceof Error) {
    failures.push(decodedStatement.message)
    return failures
  }
  const statement = decodedStatement

  expectEqual(failures, statement._type, statementType, "statement type")
  expectEqual(
    failures,
    statement.predicateType,
    predicateType,
    "statement predicate type",
  )

  const subjects = array(statement.subject)
  if (!subjects || subjects.length !== 1) {
    failures.push(
      `provenance statement must contain exactly one subject; found ${subjects?.length ?? "a malformed value"}`,
    )
  } else {
    const subject = record(subjects[0])
    if (!subject) {
      failures.push("provenance subject must be an object")
    } else {
      expectEqual(
        failures,
        subject.name,
        npmPackagePurl(expected.packageName, expected.packageVersion),
        "provenance subject",
      )
      const digest = record(subject.digest)
      const expectedDigest = integrityHexDigest(expected.integrity)
      if (!digest) {
        failures.push("provenance subject must contain a digest object")
      } else if (expectedDigest instanceof Error) {
        failures.push(expectedDigest.message)
      } else {
        expectEqual(
          failures,
          digest.sha512,
          expectedDigest,
          "provenance subject SHA-512 digest",
        )
      }
    }
  }

  const predicate = record(statement.predicate)
  const buildDefinition = record(predicate?.buildDefinition)
  if (!buildDefinition) {
    failures.push("provenance predicate must contain a build definition")
    return failures
  }

  expectEqual(
    failures,
    buildDefinition.buildType,
    githubWorkflowBuildType,
    "provenance build type",
  )

  const workflow = record(
    record(buildDefinition.externalParameters)?.workflow,
  )
  if (!workflow) {
    failures.push(
      "provenance build definition must contain GitHub workflow parameters",
    )
  } else {
    expectEqual(
      failures,
      workflow.repository,
      `https://github.com/${expected.repository}`,
      "provenance workflow repository",
    )
    expectEqual(
      failures,
      workflow.path,
      expected.workflowPath,
      "provenance workflow path",
    )
    expectEqual(
      failures,
      workflow.ref,
      expected.ref,
      "provenance workflow ref",
    )
  }

  const githubParameters = record(
    record(buildDefinition.internalParameters)?.github,
  )
  expectEqual(
    failures,
    githubParameters?.event_name,
    "push",
    "provenance GitHub event",
  )

  const dependencies = array(buildDefinition.resolvedDependencies)
  if (!dependencies || dependencies.length !== 1) {
    failures.push(
      `provenance build definition must contain exactly one resolved dependency; found ${dependencies?.length ?? "a malformed value"}`,
    )
  } else {
    const dependency = record(dependencies[0])
    if (!dependency) {
      failures.push("provenance resolved dependency must be an object")
    } else {
      expectEqual(
        failures,
        dependency.uri,
        `git+https://github.com/${expected.repository}@${expected.ref}`,
        "provenance source URI",
      )
      expectEqual(
        failures,
        record(dependency.digest)?.gitCommit,
        expected.commit,
        "provenance source commit",
      )
    }
  }

  const runDetails = record(predicate?.runDetails)
  expectEqual(
    failures,
    record(runDetails?.builder)?.id,
    githubHostedBuilder,
    "provenance builder",
  )
  const invocationId = record(runDetails?.metadata)?.invocationId
  const invocationPattern = new RegExp(
    `^https://github\\.com/${escapeRegExp(expected.repository)}`
      + `/actions/runs/[1-9]\\d*/attempts/[1-9]\\d*$`,
  )
  if (
    typeof invocationId !== "string" ||
    !invocationPattern.test(invocationId)
  ) {
    failures.push(
      `provenance invocation ID must identify a GitHub Actions run in ${expected.repository}`,
    )
  }

  return failures
}

function npmPackagePurl(name: string, version: string): string {
  const encodedName = name.startsWith("@") ? `%40${name.slice(1)}` : name
  return `pkg:npm/${encodedName}@${version}`
}

function integrityHexDigest(integrity: string): string | Error {
  const match = integrity.match(/^sha512-([A-Za-z0-9+/]+={0,2})$/)
  if (!match?.[1]) {
    return new Error(
      "tested tarball integrity must be one canonical SHA-512 SRI value",
    )
  }
  const digest = Buffer.from(match[1], "base64")
  const normalizedInput = match[1].replace(/=+$/, "")
  const normalizedRoundTrip = digest.toString("base64").replace(/=+$/, "")
  if (digest.length !== 64 || normalizedInput !== normalizedRoundTrip) {
    return new Error(
      "tested tarball integrity must encode exactly one 64-byte SHA-512 digest",
    )
  }
  return digest.toString("hex")
}

function decodeDsseStatement(bundle: JsonRecord): JsonRecord | Error {
  const envelope = record(bundle.dsseEnvelope)
  if (envelope?.payloadType !== "application/vnd.in-toto+json") {
    return new Error(
      "verified provenance Sigstore bundle must use the in-toto DSSE payload type",
    )
  }
  const payload = envelope.payload
  if (
    typeof payload !== "string" ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(payload)
  ) {
    return new Error(
      "verified provenance Sigstore bundle must contain a base64 DSSE payload",
    )
  }

  const bytes = Buffer.from(payload, "base64")
  const normalizedInput = payload.replace(/=+$/, "")
  const normalizedRoundTrip = bytes.toString("base64").replace(/=+$/, "")
  if (bytes.length === 0 || normalizedInput !== normalizedRoundTrip) {
    return new Error(
      "verified provenance Sigstore bundle must contain a canonical base64 DSSE payload",
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(bytes.toString("utf8")) as unknown
  } catch {
    return new Error(
      "verified provenance DSSE payload must contain a JSON statement",
    )
  }

  return record(parsed) ??
    new Error("verified provenance DSSE payload must contain a statement object")
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function requireEmptyArray(
  failures: string[],
  value: JsonRecord,
  field: "invalid" | "missing",
): void {
  const entries = array(value[field])
  if (!entries) {
    failures.push(`npm audit signatures ${field} field must be an array`)
  } else if (entries.length > 0) {
    failures.push(
      `npm audit signatures reported ${entries.length} ${field} package(s)`,
    )
  }
}

function expectEqual(
  failures: string[],
  actual: unknown,
  expected: string,
  label: string,
): void {
  if (actual !== expected) {
    failures.push(
      `${label} must equal ${expected}; received ${display(actual)}`,
    )
  }
}

function record(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : undefined
}

function array(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined
}

function display(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value)
}

async function main(): Promise<void> {
  const [
    auditPath,
    packageName,
    packageVersion,
    integrity,
    repository,
    workflowPath,
    ref,
    commit,
  ] = process.argv.slice(2)
  if (
    !auditPath ||
    !packageName ||
    !packageVersion ||
    !integrity ||
    !repository ||
    !workflowPath ||
    !ref ||
    !commit
  ) {
    throw new Error(
      "Usage: verify-npm-provenance.ts <audit.json> <name> <version> <integrity> <owner/repo> <workflow-path> <ref> <commit>",
    )
  }

  const audit = JSON.parse(await readFile(auditPath, "utf8")) as unknown
  const failures = npmProvenanceFailures(audit, {
    packageName,
    packageVersion,
    integrity,
    repository,
    workflowPath,
    ref,
    commit,
  })
  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`npm provenance check failed: ${failure}`)
    }
    process.exit(1)
  }

  console.log(
    `npm provenance check passed: ${packageName}@${packageVersion} binds the tested tarball to ${repository}/${workflowPath}@${commit}`,
  )
}

if (import.meta.main) {
  try {
    await main()
  } catch (error) {
    console.error(
      `npm provenance check failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    process.exit(1)
  }
}
