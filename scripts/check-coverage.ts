const MIN_LINE_COVERAGE = 80
const lcovPath = new URL("../coverage/lcov.info", import.meta.url)

const lcov = await Bun.file(lcovPath).text().catch((error) => {
  console.error(`coverage check failed: coverage/lcov.info missing (${(error as Error).message})`)
  process.exit(1)
})

let found = 0
let hit = 0

for (const line of lcov.split(/\r?\n/)) {
  if (line.startsWith("LF:")) found += Number(line.slice(3))
  if (line.startsWith("LH:")) hit += Number(line.slice(3))
}

if (found === 0) {
  console.error("coverage check failed: coverage/lcov.info did not contain line totals")
  process.exit(1)
}

const percent = (hit / found) * 100
if (percent < MIN_LINE_COVERAGE) {
  console.error(`coverage check failed: ${percent.toFixed(2)}% line coverage is below ${MIN_LINE_COVERAGE}%`)
  process.exit(1)
}

console.log(`coverage check passed: ${percent.toFixed(2)}% line coverage >= ${MIN_LINE_COVERAGE}%`)
