export function extractReleaseNotes(
  changelog: string,
  version: string,
): string {
  const heading = releaseHeadingPattern(version)
  const lines = changelog.split(/\r?\n/)
  const matches = lines.flatMap((line, index) =>
    heading.test(line) ? [index] : []
  )

  if (matches.length !== 1) {
    throw new Error(
      `CHANGELOG.md must contain exactly one level-two heading for package version ${version}; found ${matches.length}`,
    )
  }

  const start = matches[0] + 1
  let end = lines.length
  for (let index = start; index < lines.length; index += 1) {
    if (/^##[ \t]+/.test(lines[index])) {
      end = index
      break
    }
  }

  const notes = lines.slice(start, end).join("\n").trim()
  if (!notes) {
    throw new Error(`CHANGELOG.md release notes for ${version} must not be empty`)
  }
  return `${notes}\n`
}

export function hasReleaseNotesSection(
  changelog: string,
  version: string,
): boolean {
  try {
    extractReleaseNotes(changelog, version)
    return true
  } catch {
    return false
  }
}

function releaseHeadingPattern(version: string): RegExp {
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(
    `^##[ \\t]+${escapedVersion}(?:[ \\t]+-[ \\t]+\\S.*)?[ \\t]*$`,
  )
}
