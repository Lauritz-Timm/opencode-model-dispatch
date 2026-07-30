import { rm } from "node:fs/promises"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../", import.meta.url))
const dist = fileURLToPath(new URL("../dist", import.meta.url))

await rm(dist, { recursive: true, force: true })

const declarations = Bun.spawn(
  [process.execPath, "x", "tsc", "-p", "tsconfig.json", "--emitDeclarationOnly"],
  {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  },
)
const declarationExit = await declarations.exited
if (declarationExit !== 0) {
  throw new Error(`TypeScript build failed with exit code ${declarationExit}`)
}

const bundle = await Bun.build({
  entrypoints: [fileURLToPath(new URL("../src/index.ts", import.meta.url))],
  outdir: dist,
  target: "node",
  format: "esm",
  naming: "index.js",
  minify: false,
})
if (!bundle.success) {
  for (const log of bundle.logs) console.error(log)
  throw new Error("Plugin bundle failed")
}

console.log("package build passed: declarations emitted and dist/index.js bundled for OpenCode and Node ESM")
