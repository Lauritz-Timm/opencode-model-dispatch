import { access, mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { constants } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { releasePickerAssets } from "./check-packaging"
import { startLocalNpmRegistry } from "./local-npm-registry"

const root = new URL("../", import.meta.url)
const rootPath = fileURLToPath(root)
const work = await mkdtemp(join(tmpdir(), "model-dispatch-package-"))
const npmCache = join(work, "npm-cache")
const npmPackCache = join(work, "npm-pack-cache")
const sourcePackage = JSON.parse(
  await Bun.file(new URL("../package.json", import.meta.url)).text(),
) as {
  version?: string
  devDependencies?: Record<string, string>
}
if (!sourcePackage.version) {
  throw new Error("package.json must define a version for installed-package verification")
}
const peerVersion = requiredDevelopmentVersion("@opencode-ai/plugin")
const typescriptVersion = requiredDevelopmentVersion("typescript")
const bunTypesVersion = requiredDevelopmentVersion("bun-types")

await run(["npm", "pack", "--silent", "--pack-destination", work], {
  ...process.env,
  npm_config_cache: npmPackCache,
})
const tarballs = Array.from(new Bun.Glob("*.tgz").scanSync(work))
if (tarballs.length !== 1) throw new Error(`Expected one npm tarball, found ${tarballs.length}`)
const tarballPath = join(work, tarballs[0]!)
const registry = await startLocalNpmRegistry({
  root: rootPath,
  work,
  initialTarballs: [{
    packageRoot: rootPath,
    tarballPath,
  }],
  additionalDependencies: [
    { name: "typescript" },
    { name: "bun-types" },
  ],
})
const registryEnvironment = {
  ...process.env,
  BUN_CONFIG_REGISTRY: registry.baseURL,
  BUN_INSTALL_CACHE_DIR: join(work, "bun-cache"),
  NPM_CONFIG_REGISTRY: registry.baseURL,
  npm_config_registry: registry.baseURL,
  npm_config_cache: npmCache,
  NO_PROXY: "127.0.0.1,localhost",
  no_proxy: "127.0.0.1,localhost",
}

try {
const installRoot = join(work, "consumer")
await mkdir(installRoot)
await run([
  "npm",
  "install",
  "--ignore-scripts",
  "--omit=dev",
  "--no-audit",
  "--no-fund",
  "--package-lock=false",
  "--prefix",
  installRoot,
  `opencode-model-dispatch@${sourcePackage.version}`,
  `@opencode-ai/plugin@${peerVersion}`,
  `typescript@${typescriptVersion}`,
  `bun-types@${bunTypesVersion}`,
], registryEnvironment)

const packageRoot = join(installRoot, "node_modules", "opencode-model-dispatch")
const bareImportAssertion = [
  'const plugin = await import("opencode-model-dispatch")',
  'if (typeof plugin.default !== "object" || typeof plugin.server !== "function" || typeof plugin.createModelDispatchPlugin !== "function") throw new Error("Bare package import did not expose the public plugin contract")',
].join("; ")

await run(
  [process.execPath, "--eval", bareImportAssertion],
  process.env,
  installRoot,
)
await run(
  ["node", "--input-type=module", "--eval", bareImportAssertion],
  process.env,
  installRoot,
)

const bunInstallRoot = join(work, "bun-consumer")
await mkdir(bunInstallRoot)
await writeFile(
  join(bunInstallRoot, "package.json"),
  `${JSON.stringify({
    name: "opencode-model-dispatch-bun-consumer",
    private: true,
    type: "module",
    dependencies: {
      "opencode-model-dispatch": sourcePackage.version,
      "@opencode-ai/plugin": peerVersion,
    },
  }, null, 2)}\n`,
  "utf8",
)
await run(
  [process.execPath, "install", "--ignore-scripts"],
  registryEnvironment,
  bunInstallRoot,
)
await run(
  [process.execPath, "--eval", bareImportAssertion],
  registryEnvironment,
  bunInstallRoot,
)
const bunPackageRoot = join(
  bunInstallRoot,
  "node_modules",
  "opencode-model-dispatch",
)
await verifyBunInstalledRuntime(packageRoot, bunPackageRoot)

const installed = await import(
  pathToFileURL(join(packageRoot, "dist", "index.js")).href
)
if (typeof installed.createModelDispatchPlugin !== "function") {
  throw new Error("Installed package does not export createModelDispatchPlugin")
}

await run([
  "node",
  join(installRoot, "node_modules", "typescript", "bin", "tsc"),
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
  "bun-types",
  join(packageRoot, "dist", "index.d.ts"),
], process.env, installRoot)

await verifyInstalledHookContract(installed.createModelDispatchPlugin)
await verifyNonLoopbackPersistenceBoundary(
  installed.createModelDispatchPlugin,
)
registry.assertInstalled("opencode-model-dispatch", 2)

console.log(
  `installed-package integration passed: ${tarballs[0]} resolved through a loopback-only registry by bare Node + Bun imports, compiled from isolated public types, dispatched through its installed hook contract, and kept non-loopback persistence offline`,
)
} finally {
  registry.server.stop(true)
  await rm(work, { recursive: true, force: true })
}

function requiredDevelopmentVersion(name: string): string {
  const version = sourcePackage.devDependencies?.[name]
  if (!version) {
    throw new Error(`package.json must pin ${name} for installed-package verification`)
  }
  return version
}

async function verifyBunInstalledRuntime(
  npmPackageRoot: string,
  bunPackageRoot: string,
): Promise<void> {
  const requiredRuntimeFiles = [
    "package.json",
    "dist/index.js",
    "dist/index.d.ts",
    "bin/picker.js",
  ]
  const optionalNativeAssets = releasePickerAssets.map(
    (asset) => `bin/${asset.name}`,
  )

  for (const relativePath of requiredRuntimeFiles) {
    const [npmBytes, bunBytes] = await Promise.all([
      readFile(join(npmPackageRoot, relativePath)),
      readFile(join(bunPackageRoot, relativePath)),
    ])
    if (!npmBytes.equals(bunBytes)) {
      throw new Error(
        `Bun-installed ${relativePath} differs from the exact npm tarball installed by npm`,
      )
    }
  }

  for (const relativePath of optionalNativeAssets) {
    const npmPath = join(npmPackageRoot, relativePath)
    try {
      await access(npmPath, constants.R_OK)
    } catch {
      continue
    }
    const [npmBytes, bunBytes] = await Promise.all([
      readFile(npmPath),
      readFile(join(bunPackageRoot, relativePath)),
    ])
    if (!npmBytes.equals(bunBytes)) {
      throw new Error(
        `Bun-installed ${relativePath} differs from the exact release tarball`,
      )
    }
  }

  if (process.platform !== "win32") {
    for (const relativePath of [
      "bin/picker.js",
      ...releasePickerAssets
        .filter((asset) => asset.executable)
        .map((asset) => `bin/${asset.name}`),
    ]) {
      const npmPath = join(npmPackageRoot, relativePath)
      try {
        await access(npmPath, constants.R_OK)
      } catch {
        continue
      }
      const metadata = await stat(join(bunPackageRoot, relativePath))
      if ((metadata.mode & 0o111) === 0) {
        throw new Error(
          `Bun installation did not preserve an executable mode for ${relativePath}`,
        )
      }
    }
  }
}

async function verifyInstalledHookContract(
  createModelDispatchPlugin: typeof import("../src/index").createModelDispatchPlugin,
): Promise<void> {
  const fixture = "installed-consumer"
  const logs: unknown[] = []
  const persisted: Array<{
    sessionID: string
    model: { providerID: string; modelID: string; variant?: string }
  }> = []

  const plugin = createModelDispatchPlugin({
      readSettings: async () => ({
        warnings: [],
        settings: {
          dispatch: { enabled: true, batch_ms: 1, picker_timeout_ms: 5000, technical_failure: "default_model" },
          privacy: { logging_enabled: true },
          appearance: { color_scheme: "system" },
          setup: { snoozed_until: 0 },
        },
      }),
      shouldOpenFirstRunSetup: async () => false,
      launchPicker: async (request) => ({
        kind: "submit",
        payload: {
          selections: request.rows.map((row) => ({
            taskID: row.callID,
            providerID: "openai",
            modelID: "gpt-package-e2e",
            variant: "high",
          })),
        },
      }),
      logger: {
        info: (entry) => logs.push(entry),
        error: (entry) => logs.push(entry),
      },
      persistSessionModel: async (sessionID, model) => {
        persisted.push({ sessionID, model })
      },
  })
  const hooks = await plugin({
      directory: join(work, fixture),
      client: {
        app: {
          models: async () => [{
            id: "openai",
            name: "OpenAI",
            models: [{
              id: "gpt-package-e2e",
              name: "Package E2E",
              visible: true,
              enabled: true,
              variants: { low: {}, high: {} },
            }],
          }],
          agents: async () => [{ name: "builder", description: `${fixture} builder` }],
        },
        session: {
          messages: async () => [{ role: "assistant", metadata: { model: { providerID: "openai", modelID: "gpt-package-e2e" } } }],
          get: async () => ({ data: { id: `${fixture}-child`, parentID: `${fixture}-session` } }),
        },
      },
  } as never)

  const output = { args: { subagent_type: "builder", prompt: "package-test-private-prompt" } }
  await hooks["tool.execute.before"]!(
    { tool: "task", sessionID: `${fixture}-session`, callID: `${fixture}-call` },
    output,
  )

  if (output.args.subagent_type !== "builder") {
    throw new Error(`${fixture}: installed plugin changed the agent identity; output=${JSON.stringify(output)} logs=${JSON.stringify(logs)}`)
  }
  if (output.args.prompt !== "package-test-private-prompt") {
    throw new Error(`${fixture}: installed plugin changed the task prompt`)
  }
  const chatInput = {
    sessionID: `${fixture}-child`,
    agent: "builder",
    variant: "low" as string | undefined,
  }
  const childMessage = {
    message: {
      model: {
        providerID: "default",
        modelID: "default",
        variant: "low" as string | undefined,
      },
    },
    parts: [],
  }
  await hooks["chat.message"]!(chatInput, childMessage as never)
  if (
    childMessage.message.model.providerID !== "openai" ||
    childMessage.message.model.modelID !== "gpt-package-e2e" ||
    childMessage.message.model.variant !== "high" ||
    chatInput.variant !== "high"
  ) {
    throw new Error(`${fixture}: installed plugin did not apply the selected child model and effort`)
  }
  if (
    persisted.length !== 1 ||
    persisted[0]?.sessionID !== `${fixture}-child` ||
    persisted[0]?.model.modelID !== "gpt-package-e2e" ||
    persisted[0]?.model.variant !== "high"
  ) {
    throw new Error(`${fixture}: installed plugin did not persist the selected child-session model and effort`)
  }
  const taskResult = {
    metadata: {
      model: {
        providerID: "default",
        modelID: "default",
        variant: undefined as string | undefined,
      },
    },
  }
  await hooks["tool.execute.after"]!(
    { tool: "task", sessionID: `${fixture}-session`, callID: `${fixture}-call`, args: output.args },
    taskResult as never,
  )
  if (
    taskResult.metadata.model.modelID !== "gpt-package-e2e" ||
    taskResult.metadata.model.variant !== "high"
  ) {
    throw new Error(`${fixture}: installed plugin did not report the selected model and effort in task metadata`)
  }
  await hooks.dispose?.()
}

async function verifyNonLoopbackPersistenceBoundary(
  createModelDispatchPlugin: typeof import("../src/index").createModelDispatchPlugin,
): Promise<void> {
  const originalFetch = globalThis.fetch
  let fetchCalls = 0
  globalThis.fetch = (async () => {
    fetchCalls++
    throw new Error("non-loopback persistence attempted a network request")
  }) as typeof fetch

  let hooks: Awaited<
    ReturnType<ReturnType<typeof createModelDispatchPlugin>>
  > | undefined
  try {
    const plugin = createModelDispatchPlugin({
      readSettings: async () => ({
        warnings: [],
        settings: {
          dispatch: {
            enabled: true,
            batch_ms: 1,
            picker_timeout_ms: 5000,
            technical_failure: "default_model",
          },
          privacy: { logging_enabled: false },
          appearance: { color_scheme: "system" },
          setup: { snoozed_until: 0 },
        },
      }),
      shouldOpenFirstRunSetup: async () => false,
      launchPicker: async (request) => ({
        kind: "submit",
        payload: {
          selections: request.rows.map((row) => ({
            taskID: row.callID,
            providerID: "openai",
            modelID: "gpt-package-e2e",
            variant: "high",
          })),
        },
      }),
    })
    hooks = await plugin({
      directory: join(work, "non-loopback"),
      serverUrl: new URL("https://hostile.example.invalid"),
      client: {
        app: {
          models: async () => [{
            id: "openai",
            name: "OpenAI",
            models: [{
              id: "gpt-package-e2e",
              name: "Package E2E",
              visible: true,
              enabled: true,
              variants: { high: {} },
            }],
          }],
          agents: async () => [{
            name: "builder",
            description: "non-loopback boundary",
          }],
        },
        session: {
          messages: async () => [{
            role: "assistant",
            metadata: {
              model: {
                providerID: "openai",
                modelID: "gpt-package-e2e",
              },
            },
          }],
          get: async () => ({
            data: {
              id: "non-loopback-child",
              parentID: "non-loopback-parent",
            },
          }),
        },
      },
    } as never)

    const task = {
      args: {
        subagent_type: "builder",
        prompt: "non-loopback-private-prompt",
      },
    }
    await hooks["tool.execute.before"]!(
      {
        tool: "task",
        sessionID: "non-loopback-parent",
        callID: "non-loopback-call",
      },
      task,
    )
    const chatInput = {
      sessionID: "non-loopback-child",
      agent: "builder",
    }
    const chatOutput = {
      message: {
        model: {
          providerID: "default",
          modelID: "default",
        },
      },
      parts: [],
    }
    await hooks["chat.message"]!(chatInput, chatOutput as never)

    if (
      chatOutput.message.model.providerID !== "openai" ||
      chatOutput.message.model.modelID !== "gpt-package-e2e"
    ) {
      throw new Error(
        "Installed package did not apply the selected model while enforcing the non-loopback persistence boundary",
      )
    }
    if (fetchCalls !== 0) {
      throw new Error(
        `Installed package made ${fetchCalls} fetch call(s) for a non-loopback OpenCode server URL`,
      )
    }
  } finally {
    await hooks?.dispose?.()
    globalThis.fetch = originalFetch
  }
}

async function run(
  command: string[],
  env: Record<string, string | undefined>,
  cwd = fileURLToPath(root),
): Promise<void> {
  const child = Bun.spawn(command, {
    cwd,
    env,
    stdout: "inherit",
    stderr: "inherit",
  })
  const code = await child.exited
  if (code !== 0) throw new Error(`${command.join(" ")} failed with exit code ${code}`)
}
