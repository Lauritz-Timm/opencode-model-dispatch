type PackageJson = {
  files?: string[]
  bin?: Record<string, string>
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}

const releaseAssetPattern = "picker-${platform}-${arch}${ext}"
const releaseAssetUrl =
  "https://github.com/Lauritz/opencode-model-dispatch/releases/download/${version}/picker-${platform}-${arch}${ext}"
const pickerOverrideEnv = "OPENCODE_MODEL_DISPATCH_PICKER"

const root = new URL("../", import.meta.url)
const failures: string[] = []

function fail(message: string): void {
  failures.push(message)
}

async function readText(path: string): Promise<string> {
  return await Bun.file(new URL(path, root)).text()
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readText(path)) as T
}

function expectIncludes(haystack: string | string[] | undefined, needle: string, label: string): void {
  if (!haystack?.includes(needle)) fail(`${label} must include ${needle}`)
}

function expectMissing(haystack: string | undefined, needle: string, label: string): void {
  if (haystack?.includes(needle)) fail(`${label} must not include ${needle}`)
}

const pkg = await readJson<PackageJson>("package.json")
const readme = await readText("README.md")

expectIncludes(pkg.files, "dist", "package files")
expectIncludes(pkg.files, "assets", "package files")
expectIncludes(pkg.files, "bin", "package files")
expectIncludes(pkg.files, "scripts", "package files")
if (pkg.files?.includes("picker/src-tauri")) fail("package files must not include picker/src-tauri")
if (pkg.bin?.["opencode-model-dispatch-picker"] !== "./bin/picker.js") {
  fail("package bin must expose opencode-model-dispatch-picker at ./bin/picker.js")
}

for (const lifecycle of ["install", "postinstall", "prepare"]) {
  if (pkg.scripts?.[lifecycle]) fail(`package must not define ${lifecycle}; npm install must not build native code`)
}

expectMissing(pkg.scripts?.prepublishOnly, "tauri", "prepublishOnly")
expectMissing(JSON.stringify(pkg.dependencies ?? {}), "tauri", "dependencies")
expectMissing(JSON.stringify(pkg.optionalDependencies ?? {}), "tauri", "optionalDependencies")

for (const text of [releaseAssetPattern, releaseAssetUrl, pickerOverrideEnv, "No Rust or Tauri toolchain is required"]) {
  expectIncludes(readme, text, "README")
}

for (const heading of ["## Install", "## Configuration", "## Setup", "## Privacy", "## Troubleshooting"]) {
  expectIncludes(readme, heading, "README")
}

if (failures.length > 0) {
  for (const message of failures) console.error(`packaging check failed: ${message}`)
  process.exit(1)
}

console.log(`packaging check passed: documented release asset path ${releaseAssetPattern}`)
