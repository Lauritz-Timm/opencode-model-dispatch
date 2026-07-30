interface NpmPackResult {
  integrity?: unknown
  filename?: unknown
}

export interface NpmPackArtifact {
  integrity: string
  filename: string
}

export function npmPackArtifact(value: unknown): NpmPackArtifact {
  const entries = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.values(value)
      : []

  if (entries.length !== 1) {
    throw new Error(`Expected one npm pack result, received ${entries.length}`)
  }

  const integrity = (entries[0] as NpmPackResult | undefined)?.integrity
  if (typeof integrity !== "string" || !integrity.startsWith("sha512-")) {
    throw new Error("npm pack result did not contain a SHA-512 integrity value")
  }
  const filename = (entries[0] as NpmPackResult | undefined)?.filename
  if (
    typeof filename !== "string"
    || filename.length === 0
    || filename !== filename.trim()
    || filename.includes("/")
    || filename.includes("\\")
    || !filename.endsWith(".tgz")
  ) {
    throw new Error("npm pack result did not contain a safe tarball filename")
  }
  return { integrity, filename }
}

export function npmPackIntegrity(value: unknown): string {
  return npmPackArtifact(value).integrity
}

if (import.meta.main) {
  const json = process.argv[2]
  if (!json) throw new Error("Pass the JSON output from npm pack --json")
  const artifact = npmPackArtifact(JSON.parse(json))
  const field = process.argv[3] ?? "integrity"
  if (field !== "integrity" && field !== "filename") {
    throw new Error("Optional output field must be integrity or filename")
  }
  process.stdout.write(artifact[field])
}
