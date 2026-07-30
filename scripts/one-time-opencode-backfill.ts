import {
  access,
  appendFile,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises"
import { join } from "node:path"

interface BackfillResult {
  arch: string
  duration_ms: number
  failure_tail?: string
  platform: string
  shard_count: number
  shard_index: number
  stage: "binary" | "install" | "normal" | "same-agent-fifo" | "passed"
  status: "failed" | "passed"
  version: string
}

const minimum = [1, 0, 0] as const

async function main(): Promise<void> {
  if (process.argv.includes("--summarize")) {
    await summarize(process.argv.at(-1) ?? "")
    return
  }

  const shardIndex = requiredInteger("BACKFILL_SHARD_INDEX")
  const shardCount = requiredInteger("BACKFILL_SHARD_COUNT")
  const platform = requiredEnvironment("BACKFILL_PLATFORM")
  const arch = requiredEnvironment("BACKFILL_ARCH")
  const output = requiredEnvironment("BACKFILL_RESULT_PATH")
  const versions = registryVersions().filter(
    (_, index) => index % shardCount === shardIndex,
  )
  await mkdir(join(output, ".."), { recursive: true })
  await writeFile(output, "")

  for (const version of versions) {
    const started = Date.now()
    const runtime = join(
      process.env.RUNNER_TEMP ?? "/tmp",
      `opencode-backfill-${platform}-${arch}-${shardIndex}`,
    )
    let result: BackfillResult
    try {
      await rm(runtime, { recursive: true, force: true })
      const install = run([
        npmExecutable(),
        "install",
        "--prefix",
        runtime,
        "--package-lock=false",
        "--no-audit",
        "--no-fund",
        `opencode-ai@${version}`,
      ])
      if (install.exitCode !== 0) {
        result = failedResult(
          version,
          "install",
          install,
          started,
          platform,
          arch,
          shardIndex,
          shardCount,
        )
      } else {
        const binary = await resolveInstalledOpenCodeBinary(
          runtime,
          version,
          platform,
          arch,
        )
        const environment = {
          ...process.env,
          OPENCODE_BIN: binary,
          OPENCODE_TEST_VERSION: version,
        }
        const normal = run(
          [process.execPath, "scripts/test-opencode-server.ts"],
          environment,
        )
        if (normal.exitCode !== 0) {
          result = failedResult(
            version,
            "normal",
            normal,
            started,
            platform,
            arch,
            shardIndex,
            shardCount,
          )
        } else {
          const fifo = run(
            [
              process.execPath,
              "scripts/test-opencode-server.ts",
              "--same-agent-fifo",
            ],
            environment,
          )
          result = fifo.exitCode === 0
            ? {
                arch,
                duration_ms: Date.now() - started,
                platform,
                shard_count: shardCount,
                shard_index: shardIndex,
                stage: "passed",
                status: "passed",
                version,
              }
            : failedResult(
                version,
                "same-agent-fifo",
                fifo,
                started,
                platform,
                arch,
                shardIndex,
                shardCount,
              )
        }
      }
    } catch (error) {
      result = {
        arch,
        duration_ms: Date.now() - started,
        failure_tail: String(error).slice(-8_000),
        platform,
        shard_count: shardCount,
        shard_index: shardIndex,
        stage: "binary",
        status: "failed",
        version,
      }
    } finally {
      await rm(runtime, { recursive: true, force: true }).catch(() => {})
    }

    await appendFile(output, `${JSON.stringify(result)}\n`)
    console.log(
      `${platform}-${arch} ${version}: ${result.status} (${result.stage})`,
    )
  }
}

function registryVersions(): string[] {
  const result = run(["npm", "view", "opencode-ai", "versions", "--json"])
  if (result.exitCode !== 0) {
    throw new Error(`npm versions failed: ${outputTail(result)}`)
  }
  const value = JSON.parse(result.stdout) as unknown
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error("npm versions response must be a string array")
  }
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .filter((entry) => /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(entry))
    .filter((entry) => compare(parseVersion(entry), minimum) >= 0)
    .sort((left, right) => compare(parseVersion(left), parseVersion(right)))
}

function parseVersion(value: string): readonly [number, number, number] {
  const parts = value.split(".").map(Number)
  if (
    parts.length !== 3 ||
    parts.some((part) => !Number.isSafeInteger(part) || part < 0)
  ) {
    throw new Error(`invalid stable version ${value}`)
  }
  return [parts[0]!, parts[1]!, parts[2]!]
}

function compare(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): number {
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2]
}

function run(
  command: string[],
  environment: Record<string, string | undefined> = process.env,
): { exitCode: number; stderr: string; stdout: string } {
  const result = Bun.spawnSync(command, {
    cwd: process.cwd(),
    env: environment,
    stderr: "pipe",
    stdout: "pipe",
  })
  return {
    exitCode: result.exitCode,
    stderr: result.stderr.toString(),
    stdout: result.stdout.toString(),
  }
}

function failedResult(
  version: string,
  stage: BackfillResult["stage"],
  command: { exitCode: number; stderr: string; stdout: string },
  started: number,
  platform: string,
  arch: string,
  shardIndex: number,
  shardCount: number,
): BackfillResult {
  return {
    arch,
    duration_ms: Date.now() - started,
    failure_tail: outputTail(command),
    platform,
    shard_count: shardCount,
    shard_index: shardIndex,
    stage,
    status: "failed",
    version,
  }
}

function outputTail(command: { stderr: string; stdout: string }): string {
  return `${command.stdout}\n${command.stderr}`.trim().slice(-8_000)
}

function npmExecutable(): string {
  return Bun.which("npm") ?? (process.platform === "win32" ? "npm.cmd" : "npm")
}

async function resolveInstalledOpenCodeBinary(
  runtime: string,
  version: string,
  platform: string,
  arch: string,
): Promise<string> {
  const packagePlatform = platform === "macos" ? "darwin" : platform
  const binaryName = platform === "windows" ? "opencode.exe" : "opencode"
  const packageNames = [
    `opencode-${packagePlatform}-${arch}`,
    `opencode-${packagePlatform}-${arch}-baseline`,
    `opencode-${packagePlatform}-${arch}-musl`,
    `opencode-${packagePlatform}-${arch}-baseline-musl`,
  ]
  const nodeModules = join(runtime, "node_modules")
  const candidates = [
    ...packageNames.map((name) =>
      join(nodeModules, name, "bin", binaryName)
    ),
    join(nodeModules, "opencode-ai", "bin", "opencode.exe"),
    join(nodeModules, "opencode-ai", "bin", "opencode"),
    join(nodeModules, "opencode-ai", "bin", "opencode.cmd"),
  ]
  const diagnostics: string[] = []

  for (const candidate of candidates) {
    try {
      await access(candidate)
    } catch {
      continue
    }

    try {
      const probe = run([candidate, "--version"], {
        ...process.env,
        HOME: runtime,
        OPENCODE_DISABLE_AUTOUPDATE: "true",
        USERPROFILE: runtime,
        XDG_CACHE_HOME: join(runtime, "cache"),
      })
      const output = outputTail(probe)
      if (
        probe.exitCode === 0 &&
        new RegExp(`(^|\\s)${escapeRegExp(version)}($|\\s)`).test(output)
      ) {
        return candidate
      }
      diagnostics.push(
        `${candidate}: exit ${probe.exitCode}; ${output || "no version output"}`,
      )
    } catch (error) {
      diagnostics.push(`${candidate}: ${String(error)}`)
    }
  }

  throw new Error(
    [
      `No OpenCode ${version} binary for ${platform}-${arch} passed --version.`,
      diagnostics.length
        ? diagnostics.join("\n")
        : `No candidate existed. Checked:\n${candidates.join("\n")}`,
    ].join("\n"),
  )
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

function requiredInteger(name: string): number {
  const value = Number(requiredEnvironment(name))
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a nonnegative integer`)
  }
  return value
}

async function summarize(directory: string): Promise<void> {
  if (!directory) throw new Error("summary directory is required")
  const files = await findFiles(directory)
  const results: BackfillResult[] = []
  for (const file of files.filter((path) => path.endsWith(".ndjson"))) {
    for (const line of (await readFile(file, "utf8")).split(/\r?\n/)) {
      if (!line) continue
      results.push(JSON.parse(line) as BackfillResult)
    }
  }

  results.sort((left, right) =>
    left.platform.localeCompare(right.platform) ||
    left.arch.localeCompare(right.arch) ||
    compare(parseVersion(left.version), parseVersion(right.version))
  )
  const versions = registryVersions()
  const targets = [
    "linux-x64",
    "linux-arm64",
    "macos-arm64",
    "windows-x64",
    "windows-arm64",
  ]
  const expected = new Set(
    targets.flatMap((target) => versions.map((version) => `${target}:${version}`)),
  )
  const seen = new Set(
    results.map(({ platform, arch, version }) =>
      `${platform}-${arch}:${version}`
    ),
  )
  const missing = [...expected].filter((key) => !seen.has(key))
  const failures = results.filter(({ status }) => status === "failed")
  const passed = results.length - failures.length

  await writeFile(
    "opencode-backfill-results.json",
    `${JSON.stringify({ failures, missing, results }, null, 2)}\n`,
  )
  await writeFile(
    "opencode-backfill-results.csv",
    [
      "platform,arch,opencode_version,status,stage,duration_ms",
      ...results.map((result) =>
        [
          result.platform,
          result.arch,
          result.version,
          result.status,
          result.stage,
          result.duration_ms,
        ].join(",")
      ),
      "",
    ].join("\n"),
  )
  const targetRows = targets.map((target) => {
    const targetResults = results.filter(
      ({ platform, arch }) => `${platform}-${arch}` === target,
    )
    const targetPassed = targetResults.filter(
      ({ status }) => status === "passed",
    ).length
    return `| ${target} | ${targetPassed} | ${targetResults.length - targetPassed} | ${targetResults.length} |`
  })
  const failurePreview = failures
    .slice(0, 200)
    .map((result) =>
      `- ${result.platform}-${result.arch} OpenCode ${result.version}: ${result.stage}`
    )
  const markdown = [
    "# OpenCode 1.x backfill",
    "",
    `Tested records: ${results.length}/${expected.size}`,
    `Passed: ${passed}`,
    `Failed: ${failures.length}`,
    `Missing: ${missing.length}`,
    "",
    "| Target | Passed | Failed | Total |",
    "| --- | ---: | ---: | ---: |",
    ...targetRows,
    "",
    "## Failure preview",
    "",
    ...(failurePreview.length ? failurePreview : ["No failures."]),
    failures.length > failurePreview.length
      ? `\n${failures.length - failurePreview.length} additional failures are in the JSON artifact.`
      : "",
    "",
  ].join("\n")
  await writeFile("opencode-backfill-summary.md", markdown)
  await appendFile(
    requiredEnvironment("GITHUB_OUTPUT"),
    `failures=${failures.length}\nmissing=${missing.length}\ntotal=${results.length}\n`,
  )
}

async function findFiles(directory: string): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await findFiles(path))
    else files.push(path)
  }
  return files
}

await main()
