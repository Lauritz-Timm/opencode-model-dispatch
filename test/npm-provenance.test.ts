import { Buffer } from "node:buffer"
import { describe, expect, test } from "bun:test"

import {
  npmProvenanceFailures,
  type ExpectedNpmProvenance,
} from "../scripts/verify-npm-provenance"

const digest = Buffer.alloc(64, 0xab)
const expected: ExpectedNpmProvenance = {
  packageName: "opencode-model-dispatch",
  packageVersion: "0.1.0",
  integrity: `sha512-${digest.toString("base64")}`,
  repository: "Lauritz-Timm/opencode-model-dispatch",
  workflowPath: ".github/workflows/publish.yml",
  ref: "refs/tags/v0.1.0",
  commit: "0123456789abcdef0123456789abcdef01234567",
}

function verifiedAudit(): Record<string, unknown> {
  const statement = {
    _type: "https://in-toto.io/Statement/v1",
    subject: [{
      name: "pkg:npm/opencode-model-dispatch@0.1.0",
      digest: { sha512: digest.toString("hex") },
    }],
    predicateType: "https://slsa.dev/provenance/v1",
    predicate: {
      buildDefinition: {
        buildType:
          "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1",
        externalParameters: {
          workflow: {
            ref: expected.ref,
            repository: `https://github.com/${expected.repository}`,
            path: expected.workflowPath,
          },
        },
        internalParameters: {
          github: { event_name: "push" },
        },
        resolvedDependencies: [{
          uri:
            `git+https://github.com/${expected.repository}@${expected.ref}`,
          digest: { gitCommit: expected.commit },
        }],
      },
      runDetails: {
        builder: {
          id: "https://github.com/actions/runner/github-hosted",
        },
        metadata: {
          invocationId:
            `https://github.com/${expected.repository}/actions/runs/123456/attempts/1`,
        },
      },
    },
  }
  return {
    invalid: [],
    missing: [],
    verified: [{
      name: expected.packageName,
      version: expected.packageVersion,
      location: `node_modules/${expected.packageName}`,
      registry: "https://registry.npmjs.org/",
      attestations: {
        url: "https://registry.npmjs.org/-/npm/v1/attestations/opencode-model-dispatch@0.1.0",
      },
      attestationBundles: [{
        predicateType: "https://slsa.dev/provenance/v1",
        bundle: {
          mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json",
          dsseEnvelope: {
            payloadType: "application/vnd.in-toto+json",
            payload: Buffer.from(JSON.stringify(statement)).toString("base64"),
            signatures: [{ sig: "synthetic-test-signature" }],
          },
        },
      }],
    }],
  }
}

function provenanceStatement(
  audit: Record<string, unknown>,
): Record<string, any> {
  const bundle = (audit.verified as any[])[0].attestationBundles[0].bundle
  return JSON.parse(
    Buffer.from(bundle.dsseEnvelope.payload, "base64").toString("utf8"),
  )
}

function rewriteProvenanceStatement(
  audit: Record<string, unknown>,
  mutate: (statement: Record<string, any>) => void,
): void {
  const bundle = (audit.verified as any[])[0].attestationBundles[0].bundle
  const statement = provenanceStatement(audit)
  mutate(statement)
  bundle.dsseEnvelope.payload =
    Buffer.from(JSON.stringify(statement)).toString("base64")
}

describe("npm provenance verification", () => {
  test("accepts a verified SLSA statement bound to the tested tarball and release source", () => {
    expect(npmProvenanceFailures(verifiedAudit(), expected)).toEqual([])
  })

  test("fails closed on invalid, missing, or absent verified attestations", () => {
    expect(npmProvenanceFailures({
      ...verifiedAudit(),
      invalid: [{ name: expected.packageName }],
    }, expected)).toContain(
      "npm audit signatures reported 1 invalid package(s)",
    )
    expect(npmProvenanceFailures({
      ...verifiedAudit(),
      missing: [{ name: expected.packageName }],
    }, expected)).toContain(
      "npm audit signatures reported 1 missing package(s)",
    )
    expect(npmProvenanceFailures({
      invalid: [],
      missing: [],
    }, expected)).toContain(
      "npm audit signatures output must contain a verified array; run with --json --include-attestations",
    )
  })

  test("rejects a different tarball digest", () => {
    const audit = verifiedAudit()
    rewriteProvenanceStatement(audit, (statement) => {
      statement.subject[0].digest.sha512 = "00".repeat(64)
    })

    expect(npmProvenanceFailures(audit, expected)).toContain(
      `provenance subject SHA-512 digest must equal ${digest.toString("hex")}; received ${"00".repeat(64)}`,
    )
  })

  test("rejects a different repository, workflow, ref, or commit", () => {
    const audit = verifiedAudit()
    rewriteProvenanceStatement(audit, (statement) => {
      const build = statement.predicate.buildDefinition
      build.externalParameters.workflow.repository =
        "https://github.com/attacker/repository"
      build.externalParameters.workflow.path = ".github/workflows/other.yml"
      build.externalParameters.workflow.ref = "refs/heads/main"
      build.resolvedDependencies[0].uri =
        "git+https://github.com/attacker/repository@refs/heads/main"
      build.resolvedDependencies[0].digest.gitCommit =
        "f".repeat(40)
    })

    const failures = npmProvenanceFailures(audit, expected)
    expect(failures.some((failure) =>
      failure.startsWith("provenance workflow repository must equal"),
    )).toBe(true)
    expect(failures.some((failure) =>
      failure.startsWith("provenance workflow path must equal"),
    )).toBe(true)
    expect(failures.some((failure) =>
      failure.startsWith("provenance workflow ref must equal"),
    )).toBe(true)
    expect(failures.some((failure) =>
      failure.startsWith("provenance source URI must equal"),
    )).toBe(true)
    expect(failures.some((failure) =>
      failure.startsWith("provenance source commit must equal"),
    )).toBe(true)
  })

  test("rejects malformed integrity and non-GitHub provenance", () => {
    const audit = verifiedAudit()
    rewriteProvenanceStatement(audit, (statement) => {
      statement.predicate.buildDefinition.buildType = "other-build"
      statement.predicate.runDetails.builder.id = "self-hosted"
      statement.predicate.runDetails.metadata.invocationId =
        "https://attacker.invalid/actions/runs/1/attempts/1"
    })

    const failures = npmProvenanceFailures(audit, {
      ...expected,
      integrity: "sha512-not-base64!",
    })
    expect(failures).toContain(
      "tested tarball integrity must be one canonical SHA-512 SRI value",
    )
    expect(failures.some((failure) =>
      failure.startsWith("provenance build type must equal"),
    )).toBe(true)
    expect(failures.some((failure) =>
      failure.startsWith("provenance builder must equal"),
    )).toBe(true)
    expect(failures).toContain(
      `provenance invocation ID must identify a GitHub Actions run in ${expected.repository}`,
    )
  })

  test("decodes the statement from the verified DSSE payload", () => {
    const audit = verifiedAudit()
    const provenance =
      (audit.verified as any[])[0].attestationBundles[0]
    provenance.statement = provenanceStatement(audit)
    provenance.statement.predicate.buildDefinition
      .externalParameters.workflow.repository =
        "https://github.com/attacker/repository"

    expect(npmProvenanceFailures(audit, expected)).toEqual([])

    provenance.bundle.dsseEnvelope.payload = "not base64!"
    expect(npmProvenanceFailures(audit, expected)).toContain(
      "verified provenance Sigstore bundle must contain a base64 DSSE payload",
    )

    provenance.bundle.dsseEnvelope.payloadType = "text/plain"
    expect(npmProvenanceFailures(audit, expected)).toContain(
      "verified provenance Sigstore bundle must use the in-toto DSSE payload type",
    )
  })
})
