import { spawn } from "node:child_process"
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../", import.meta.url))
const manifest = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
)
const packageName = requiredString(manifest.name, "package name")
const work = await mkdtemp(join(tmpdir(), "model-dispatch-node-consumer-"))
const npmCache = join(work, "npm-cache")
const npmPackCache = join(work, "npm-pack-cache")

try {
  const packageRoot = join(work, "package")
  await mkdir(packageRoot)
  await run([
    "npm",
    "pack",
    "--silent",
    "--ignore-scripts",
    "--pack-destination",
    packageRoot,
  ], root, {
    npm_config_cache: npmPackCache,
  })

  const tarballs = (await readdir(packageRoot))
    .filter((entry) => entry.endsWith(".tgz"))
  if (tarballs.length !== 1) {
    throw new Error(`Expected one npm tarball, found ${tarballs.length}`)
  }
  const tarball = join(packageRoot, tarballs[0])

  const consumer = join(work, "consumer")
  await mkdir(consumer)
  await writeFile(
    join(consumer, "package.json"),
    `${JSON.stringify({
      name: "opencode-model-dispatch-node-consumer",
      private: true,
      type: "module",
    }, null, 2)}\n`,
    "utf8",
  )
  await run([
    "npm",
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--package-lock=false",
    "--save-exact",
    "--legacy-peer-deps",
    "--offline",
    tarball,
  ], consumer, {
    npm_config_offline: "true",
    npm_config_registry: "http://127.0.0.1:9",
  })

  await mkdir(join(consumer, "node_modules", "@opencode-ai"), {
    recursive: true,
  })
  await symlink(
    join(root, "node_modules", "@opencode-ai", "plugin"),
    join(consumer, "node_modules", "@opencode-ai", "plugin"),
    "dir",
  )
  await mkdir(join(consumer, "node_modules", "@types"), {
    recursive: true,
  })
  await symlink(
    join(root, "node_modules", "@types", "node"),
    join(consumer, "node_modules", "@types", "node"),
    "dir",
  )

  await writeFile(
    join(consumer, "runtime.mjs"),
    [
      `import plugin, { createModelDispatchPlugin, server } from ${JSON.stringify(packageName)}`,
      "if (typeof plugin !== \"object\" || typeof plugin.server !== \"function\") throw new Error(\"Default package export is invalid\")",
      "if (typeof createModelDispatchPlugin !== \"function\" || typeof server !== \"function\") throw new Error(\"Named package exports are invalid\")",
      "",
    ].join("\n"),
    "utf8",
  )
  await run([process.execPath, "runtime.mjs"], consumer)

  await writeFile(
    join(consumer, "consumer.ts"),
    [
      `import plugin, { createModelDispatchPlugin, server, type ModelDispatchPluginDeps, type PickerThemeHint } from ${JSON.stringify(packageName)}`,
      "const deps: ModelDispatchPluginDeps = {}",
      "const theme: PickerThemeHint = { colorScheme: \"system\" }",
      "const factory: typeof createModelDispatchPlugin = createModelDispatchPlugin",
      "const exportedServer: typeof server = plugin.server",
      "void [deps, theme, factory, exportedServer]",
      "",
    ].join("\n"),
    "utf8",
  )
  await run([
    process.execPath,
    join(root, "node_modules", "typescript", "bin", "tsc"),
    "--noEmit",
    "--target",
    "ES2022",
    "--module",
    "NodeNext",
    "--moduleResolution",
    "NodeNext",
    "--skipLibCheck",
    "false",
    "--types",
    "node",
    "consumer.ts",
  ], consumer)

  console.log(
    `Node ${process.versions.node} consumer passed: exact local tarball resolved by bare ESM import and isolated public types without registry access`,
  )
} finally {
  await rm(work, { recursive: true, force: true })
}

function requiredString(value, label) {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    throw new Error(`package.json is missing ${label}`)
  }
  return value
}

async function run(command, cwd, environment = {}) {
  const child = spawn(command[0], command.slice(1), {
    cwd,
    env: {
      ...process.env,
      npm_config_cache: npmCache,
      ...environment,
    },
    stdio: "inherit",
  })
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject)
    child.once("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${command.join(" ")} terminated by ${signal}`))
        return
      }
      resolve(code)
    })
  })
  if (exitCode !== 0) {
    throw new Error(`${command.join(" ")} failed with exit code ${exitCode}`)
  }
}
