import { readFile, writeFile } from "node:fs/promises"

import { extractReleaseNotes } from "./release-notes"

const outputFlag = process.argv.indexOf("--output")
const outputPath = outputFlag === -1 ? undefined : process.argv[outputFlag + 1]
if (!outputPath || outputPath.startsWith("-")) {
  throw new Error("usage: bun scripts/extract-release-notes.ts --output <path>")
}

const manifest = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
) as { version?: unknown }
if (
  typeof manifest.version !== "string" ||
  !manifest.version ||
  manifest.version.trim() !== manifest.version
) {
  throw new Error("package.json version must be a nonempty trimmed string")
}

const changelog = await readFile(
  new URL("../CHANGELOG.md", import.meta.url),
  "utf8",
)
const notes = extractReleaseNotes(changelog, manifest.version)
await writeFile(outputPath, notes, "utf8")
console.log(`release notes extracted for ${manifest.version}: ${outputPath}`)
