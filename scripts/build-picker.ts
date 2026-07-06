import { chmod, mkdir, readdir, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

const pickerRoot = fileURLToPath(new URL("../picker", import.meta.url))
const distPickerRoot = fileURLToPath(new URL("../dist-picker", import.meta.url))
const pickerProject = new URL("../picker/package.json", import.meta.url)
const pickerSrc = fileURLToPath(new URL("../picker/src", import.meta.url))
const pickerViteBin = new URL("../picker/node_modules/.bin/vite", import.meta.url)
const pickerViteCmd = new URL("../picker/node_modules/.bin/vite.cmd", import.meta.url)
const pickerViteExe = new URL("../picker/node_modules/.bin/vite.exe", import.meta.url)

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
  console.log("picker build skipped: picker/package.json is not present yet")
  await writeReleaseAsset()
  process.exit(0)
}

if (!(await hasTypeScriptSource(pickerSrc))) {
  console.log("picker build skipped: picker/src has no TypeScript sources yet")
  await writeReleaseAsset()
  process.exit(0)
}

if (
  !(await Bun.file(pickerViteBin).exists()) &&
  !(await Bun.file(pickerViteCmd).exists()) &&
  !(await Bun.file(pickerViteExe).exists())
) {
  console.log("picker build skipped: picker dependencies are not installed")
  await writeReleaseAsset()
  process.exit(0)
}

const proc = Bun.spawn([process.execPath, "run", "build"], {
  cwd: pickerRoot,
  stdout: "inherit",
  stderr: "inherit",
})

const exitCode = await proc.exited
if (exitCode === 0) await writeReleaseAsset()
process.exit(exitCode)

async function writeReleaseAsset(): Promise<void> {
  const platform = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : process.platform
  const arch = process.arch
  const ext = platform === "windows" ? ".exe" : ""
  const assetPattern = "picker-${platform}-${arch}${ext}"
  const assetName = `picker-${platform}-${arch}${ext}`
  await mkdir(distPickerRoot, { recursive: true })
  const path = `${distPickerRoot}/${assetName}`
  const script = platform === "windows"
    ? `@echo off\necho ${assetPattern} placeholder: build native Tauri picker before release.\nexit /b 1\n`
    : `#!/usr/bin/env sh\necho "${assetPattern} placeholder: build native Tauri picker before release." >&2\nexit 1\n`
  await writeFile(path, script, "utf8")
  if (platform !== "windows") await chmod(path, 0o755)
  console.log(`picker release asset written to dist-picker/${assetName}`)
}
