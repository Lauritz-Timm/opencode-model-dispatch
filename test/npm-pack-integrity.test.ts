import { describe, expect, test } from "bun:test"

import { npmPackArtifact, npmPackIntegrity } from "../scripts/npm-pack-integrity"

describe("npm pack retry integrity", () => {
  test("accepts the npm 11 array response and npm 12 keyed response", () => {
    const integrity = `sha512-${"a".repeat(86)}==`

    expect(npmPackIntegrity([{
      integrity,
      filename: "opencode-model-dispatch-0.1.0.tgz",
    }])).toBe(integrity)
    expect(npmPackIntegrity({
      "opencode-model-dispatch": {
        integrity,
        filename: "opencode-model-dispatch-0.1.0.tgz",
      },
    })).toBe(integrity)
    expect(npmPackArtifact([{
      integrity,
      filename: "opencode-model-dispatch-0.1.0.tgz",
    }])).toEqual({
      integrity,
      filename: "opencode-model-dispatch-0.1.0.tgz",
    })
  })

  test("fails closed on ambiguous or malformed pack output", () => {
    expect(() => npmPackIntegrity([])).toThrow("Expected one npm pack result")
    expect(() => npmPackIntegrity({
      first: { integrity: "sha512-one" },
      second: { integrity: "sha512-two" },
    })).toThrow("Expected one npm pack result")
    expect(() => npmPackIntegrity([{
      integrity: "sha256-not-release-integrity",
      filename: "package.tgz",
    }]))
      .toThrow("did not contain a SHA-512 integrity value")
    expect(() => npmPackArtifact([{
      integrity: `sha512-${"a".repeat(86)}==`,
      filename: "../package.tgz",
    }])).toThrow("safe tarball filename")
  })
})
