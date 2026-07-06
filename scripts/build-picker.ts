import { chmod, copyFile, mkdir, readdir } from "node:fs/promises"
import { fileURLToPath } from "node:url"

const pickerRoot = fileURLToPath(new URL("../picker", import.meta.url))
const distPickerRoot = fileURLToPath(new URL("../dist-picker", import.meta.url))
const pickerProject = new URL("../picker/package.json", import.meta.url)
const pickerSrc = fileURLToPath(new URL("../picker/src", import.meta.url))
const pickerTauriSrc = fileURLToPath(new URL("../picker/src-tauri", import.meta.url))
const pickerViteBin = new URL("../picker/node_modules/.bin/vite", import.meta.url)
const pickerViteCmd = new URL("../picker/node_modules/.bin/vite.cmd", import.meta.url)
const pickerViteExe = new URL("../picker/node_modules/.bin/vite.exe", import.meta.url)
const pickerTauriBin = new URL("../picker/node_modules/.bin/tauri", import.meta.url)
const pickerTauriCmd = new URL("../picker/node_modules/.bin/tauri.cmd", import.meta.url)
const pickerTauriExe = new URL("../picker/node_modules/.bin/tauri.exe", import.meta.url)
const nativeBinaryBaseName = "opencode-model-dispatch-picker"

async function hasTypeScriptSource(path: string): Promise<boolean> {
  try {
    const entries = await readdir(path, { withFileTypes: true })
    for (const entry of entries) {
      const child = `${path}/${entry.name}`
      if (entry.isDirectory() && (await hasTypeScriptSource(child))) return true
      if (entry.isFile() && /\.(ts|svelte)$/.test(entry.name)) return true
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false
    throw error
  }
  return false
}

if (!(await Bun.file(pickerProject).exists())) {
  console.error("picker build failed: picker/package.json is not present")
  process.exit(1)
}

if (!(await hasTypeScriptSource(pickerSrc))) {
  console.error("picker build failed: picker/src has no TypeScript sources")
  process.exit(1)
}

if (!(await Bun.file(`${pickerTauriSrc}/Cargo.toml`).exists())) {
  console.error("picker build failed: picker/src-tauri/Cargo.toml is not present")
  process.exit(1)
}

if (
  !(await Bun.file(pickerViteBin).exists()) &&
  !(await Bun.file(pickerViteCmd).exists()) &&
  !(await Bun.file(pickerViteExe).exists())
) {
  console.error("picker build failed: picker Vite dependency is not installed")
  process.exit(1)
}

if (
  !(await Bun.file(pickerTauriBin).exists()) &&
  !(await Bun.file(pickerTauriCmd).exists()) &&
  !(await Bun.file(pickerTauriExe).exists())
) {
  console.error("picker build failed: picker Tauri dependency is not installed")
  process.exit(1)
}

const proc = Bun.spawn([process.execPath, "run", "tauri", "build", "--no-bundle", "--ci"], {
  cwd: pickerRoot,
  stdout: "inherit",
  stderr: "inherit",
})

const exitCode = await proc.exited
if (exitCode === 0) await copyReleaseAsset()
process.exit(exitCode)

async function copyReleaseAsset(): Promise<void> {
  const platform = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : process.platform
  const arch = process.arch
  const ext = platform === "windows" ? ".exe" : ""
  const assetName = `picker-${platform}-${arch}${ext}`
  const binaryName = `${nativeBinaryBaseName}${ext}`
  const sourcePath = `${pickerTauriSrc}/target/release/${binaryName}`
  await mkdir(distPickerRoot, { recursive: true })
  const destinationPath = `${distPickerRoot}/${assetName}`
  await copyFile(sourcePath, destinationPath)
  if (platform !== "windows") await chmod(destinationPath, 0o755)
  console.log(`picker release asset copied to dist-picker/${assetName}`)
}
