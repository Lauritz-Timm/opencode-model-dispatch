import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

type DependencySection = "dependencies" | "devDependencies" | "peerDependencies"

interface NoticeComponent {
  name: string
  version: string
  license: string
  source: string
  usage: string
  manifest?: string
  dependencySection?: DependencySection
  dependencyName?: string
  lockfile?: string
  licenseFile: string
}

interface NoticeInventory {
  schemaVersion: number
  cargoAboutVersion: string
  components: NoticeComponent[]
}

const root = fileURLToPath(new URL("../", import.meta.url))
const inventoryPath = join(root, "third-party/components.json")
const rustNoticesPath = join(root, "third-party/RUST_THIRD_PARTY_LICENSES.md")
const combinedNoticesPath = join(root, "THIRD_PARTY_NOTICES.md")

function sha256(contents: string): string {
  return createHash("sha256").update(contents).digest("hex")
}

function normalizeGeneratedMarkdown(contents: string): string {
  return `${contents
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .trimEnd()}\n`
}

function dependencyLockSignature(name: string, version: string): string {
  return `"${name}": ["${name}@${version}"`
}

async function validateComponent(component: NoticeComponent): Promise<string> {
  if (
    component.manifest !== undefined ||
    component.dependencySection !== undefined ||
    component.dependencyName !== undefined ||
    component.lockfile !== undefined
  ) {
    if (!component.manifest || !component.dependencySection || !component.dependencyName || !component.lockfile) {
      throw new Error(`Component ${component.name} has an incomplete manifest/lockfile binding`)
    }

    const manifest = JSON.parse(await readFile(join(root, component.manifest), "utf8")) as Record<
      string,
      Record<string, string> | undefined
    >
    const declaredVersion = manifest[component.dependencySection]?.[component.dependencyName]
    if (declaredVersion !== component.version) {
      throw new Error(
        `${component.name} inventory version ${component.version} does not match ` +
          `${component.manifest} (${String(declaredVersion)})`,
      )
    }

    const lockfile = await readFile(join(root, component.lockfile), "utf8")
    const signature = dependencyLockSignature(component.dependencyName, component.version)
    if (!lockfile.includes(signature)) {
      throw new Error(`${component.lockfile} does not lock ${component.dependencyName} at ${component.version}`)
    }
  }

  const licenseText = (await readFile(join(root, component.licenseFile), "utf8")).trim()
  if (!licenseText.includes("Permission is hereby granted")) {
    throw new Error(`${component.licenseFile} does not contain the expected license grant`)
  }
  return licenseText
}

function cargoAboutCommand(): { command: string; prefix: string[] } {
  const explicit = process.env.CARGO_ABOUT_BIN
  return explicit ? { command: explicit, prefix: [] } : { command: "cargo", prefix: ["about"] }
}

function runCargoAbout(args: string[], expectedVersion: string): void {
  const { command, prefix } = cargoAboutCommand()
  const version = spawnSync(command, [...prefix, "--version"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
  if (version.status !== 0) {
    throw new Error(
      `cargo-about ${expectedVersion} is required. Install it with ` +
        `cargo install --locked cargo-about --version ${expectedVersion} --features cli`,
    )
  }
  const actualVersion = version.stdout.trim()
  if (actualVersion !== `cargo-about ${expectedVersion}`) {
    throw new Error(`Expected cargo-about ${expectedVersion}, got ${actualVersion || "<unknown>"}`)
  }

  const generated = spawnSync(command, [...prefix, "generate", ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
  if (generated.status !== 0) {
    throw new Error(`cargo-about failed:\n${generated.stderr || generated.stdout}`)
  }
}

async function generateRustNotices(expectedVersion: string, outputPath: string): Promise<string> {
  runCargoAbout(
    [
      "--manifest-path",
      join(root, "picker/src-tauri/Cargo.toml"),
      "--config",
      join(root, "third-party/about.toml"),
      "--frozen",
      "--fail",
      "--output-file",
      outputPath,
      join(root, "third-party/about.hbs"),
    ],
    expectedVersion,
  )
  return normalizeGeneratedMarkdown(await readFile(outputPath, "utf8"))
}

async function renderCombinedNotices(
  inventory: NoticeInventory,
  rustNotices: string,
  licenseTexts: string[],
): Promise<string> {
  const lockfiles = await Promise.all(
    ["bun.lock", "picker/bun.lock", "picker/src-tauri/Cargo.lock"].map(async (path) => ({
      path,
      digest: sha256(await readFile(join(root, path), "utf8")),
    })),
  )

  const sections = inventory.components.map((component, index) => {
    return [
      `### ${component.name} ${component.version}`,
      "",
      component.usage,
      "",
      `Source: ${component.source}`,
      "",
      `License: ${component.license}`,
      "",
      "```text",
      licenseTexts[index],
      "```",
    ].join("\n")
  })

  const rustSection = rustNotices.replace(/^# Rust third-party licenses/, "## Rust third-party licenses").trim()
  return [
    "# Third-Party Notices",
    "",
    "This file is generated from the locked dependency graphs and the reviewed",
    "component inventory in `third-party/components.json`. Do not edit it by hand.",
    "",
    "Dependency inputs:",
    "",
    ...lockfiles.map(({ path, digest }) => `- \`${path}\` (SHA-256: \`${digest}\`)`),
    "",
    "## Bundled JavaScript and adapted source",
    "",
    ...sections.flatMap((section) => [section, ""]),
    rustSection,
    "",
  ].join("\n")
}

async function assertMatches(path: string, expected: string): Promise<void> {
  let actual: string
  try {
    actual = await readFile(path, "utf8")
  } catch {
    throw new Error(`${path} is missing; regenerate third-party notices`)
  }
  if (actual !== expected) {
    throw new Error(`${path} is stale; regenerate third-party notices`)
  }
}

async function main(): Promise<void> {
  const check = process.argv.slice(2).includes("--check")
  const inventory = JSON.parse(await readFile(inventoryPath, "utf8")) as NoticeInventory
  if (inventory.schemaVersion !== 1 || !inventory.cargoAboutVersion || inventory.components.length === 0) {
    throw new Error("third-party/components.json has an unsupported or empty schema")
  }

  const licenseTexts = await Promise.all(inventory.components.map(validateComponent))
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "opencode-model-dispatch-notices-"))
  try {
    const temporaryRustNotices = join(temporaryDirectory, "RUST_THIRD_PARTY_LICENSES.md")
    const rustNotices = await generateRustNotices(inventory.cargoAboutVersion, temporaryRustNotices)
    const combinedNotices = await renderCombinedNotices(inventory, rustNotices, licenseTexts)

    if (check) {
      await assertMatches(rustNoticesPath, rustNotices)
      await assertMatches(combinedNoticesPath, combinedNotices)
      console.log(
        `third-party notices passed: ${inventory.components.length} reviewed JS/source components and locked Rust graph`,
      )
    } else {
      await writeFile(rustNoticesPath, rustNotices)
      await writeFile(combinedNoticesPath, combinedNotices)
      console.log(`generated ${resolve(root, rustNoticesPath)} and ${resolve(root, combinedNoticesPath)}`)
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
}

if (import.meta.main) {
  await main()
}
