import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { constants } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import {
  startLocalNpmRegistry,
  type LocalNpmRegistry,
} from "./local-npm-registry"
import { PICKER_SMOKE_STARTUP_TIMEOUT_MS } from "./picker-smoke-fixture"

const PINNED_OPENCODE_VERSION = "1.18.7"
const OPENCODE_VERSION = expectedOpenCodeVersion()
const PROVIDER_ID = "dispatch-test"
const PARENT_MODEL_ID = "parent-model"
const CHILD_MODEL_ID = "child-model"
const SECOND_CHILD_MODEL_ID = "second-child-model"
const SELECTED_VARIANT = "high"
const OVERRIDE_VARIANT = "medium"
const CHILD_PROMPT = "Return the deterministic child marker and do nothing else."
const SECOND_CHILD_PROMPT = "Return the deterministic second child marker and do nothing else."
const FIRST_TASK_CALL_ID = "call_dispatch_integration_first"
const SECOND_TASK_CALL_ID = "call_dispatch_integration_second"
const PARENT_PROMPT =
  "Use the task tool exactly once with subagent_type general. Return its result."
const CONCURRENT_PARENT_PROMPT =
  "Use the task tool exactly twice in parallel with subagent_type general. Return both results."
const OPENCODE_STARTUP_TIMEOUT_MS = 180_000
const FAKE_PICKER_STARTUP_TIMEOUT_MS = 30_000
const PARENT_PROMPT_TIMEOUT_MS = 120_000
const TUI_READY_TIMEOUT_MS = 30_000

const root = fileURLToPath(new URL("../", import.meta.url))
const work = await mkdtemp(join(tmpdir(), "model-dispatch-opencode-"))
const project = join(work, "project")
const openCodeDirectory = join(project, ".opencode")
const pluginDirectory = join(project, ".opencode", "plugins")
const home = join(work, "home")
const pickerPath = join(work, "fake-picker")
const pickerEvidencePath = join(work, "picker-evidence.json")
const tuiLauncherPath = join(work, "run-opencode-tui")
const xdg = {
  data: join(work, "xdg-data"),
  config: join(work, "xdg-config"),
  cache: join(work, "xdg-cache"),
  state: join(work, "xdg-state"),
}
const installedPluginPackage = process.env.MODEL_DISPATCH_TEST_PLUGIN_PACKAGE
const installedPluginTarball = process.env.MODEL_DISPATCH_TEST_PLUGIN_TARBALL
const useBundledNativePicker = process.env.MODEL_DISPATCH_TEST_USE_BUNDLED_PICKER === "1"
const useTui = process.env.MODEL_DISPATCH_TEST_TUI === "1"
const testConcurrentSameAgentFifo = process.argv.includes("--same-agent-fifo")
const testBatchOverride = process.argv.includes("--batch-override")
const testTwoTaskBatch = testConcurrentSameAgentFifo || testBatchOverride
const parentPrompt = testTwoTaskBatch ? CONCURRENT_PARENT_PROMPT : PARENT_PROMPT

let child: ReturnType<typeof Bun.spawn> | undefined
let stdoutText: Promise<string> | undefined
let stderrText: Promise<string> | undefined
let stdoutCapture: OutputCapture | undefined
let llm: FakeLLM | undefined
let npmRegistry: LocalNpmRegistry | undefined
try {
  assert(!useTui || process.platform === "linux", "Real OpenCode TUI automation requires Linux")
  assert(
    !testConcurrentSameAgentFifo || (!useTui && !useBundledNativePicker),
    "The same-agent FIFO regression uses the deterministic fake picker and server API mode",
  )
  assert(
    !testBatchOverride || useBundledNativePicker,
    "The global-plus-row override regression requires the bundled native picker",
  )
  assert(
    Boolean(installedPluginPackage) === Boolean(installedPluginTarball),
    "Installed-package integration requires both the package directory and exact tarball",
  )
  const opencode = await resolveOpenCodeBinary()
  await assertOpenCodeVersion(opencode)
  llm = startFakeLLM(await reservePort())
  if (installedPluginPackage && installedPluginTarball) {
    npmRegistry = await startLocalNpmRegistry(
      {
        port: await reservePort(),
        root,
        work,
        initialTarballs: [{
          packageRoot: installedPluginPackage,
          tarballPath: installedPluginTarball,
        }],
      },
    )
  }
  const port = await reservePort()

  await mkdir(pluginDirectory, { recursive: true })
  await seedLocalPluginRuntime(openCodeDirectory)
  await mkdir(join(home, ".config", "opencode"), { recursive: true })
  for (const path of Object.values(xdg)) await mkdir(path, { recursive: true })
  if (!installedPluginPackage) {
    await writePluginShim(
      join(root, "dist", "index.js"),
      join(pluginDirectory, "model-dispatch.js"),
    )
  }
  await writeFile(
    join(project, "opencode.json"),
    `${JSON.stringify(
      openCodeConfig(llm.baseURL, Boolean(npmRegistry)),
      null,
      2,
    )}\n`,
    "utf8",
  )
  await writeFile(
    join(home, ".config", "opencode", "model-dispatch.json"),
    `${JSON.stringify({
      privacy: { logging_enabled: false },
      dispatch: {
        enabled: true,
        batch_ms: testTwoTaskBatch ? 25 : 1,
        picker_timeout_ms: useBundledNativePicker
          ? PICKER_SMOKE_STARTUP_TIMEOUT_MS
          : FAKE_PICKER_STARTUP_TIMEOUT_MS,
        technical_failure: "default_model",
      },
    }, null, 2)}\n`,
    "utf8",
  )
  if (!useBundledNativePicker) {
    await writeFile(pickerPath, fakePickerSource(), "utf8")
    await chmod(pickerPath, 0o755)
  }

  const openCodeEnvironment: Record<string, string | undefined> = {
    ...process.env,
    HOME: home,
    XDG_DATA_HOME: xdg.data,
    XDG_CONFIG_HOME: xdg.config,
    XDG_CACHE_HOME: xdg.cache,
    XDG_STATE_HOME: xdg.state,
    OPENCODE_DISABLE_AUTOUPDATE: "true",
    OPENCODE_DISABLE_CLAUDE_CODE: "true",
    OPENCODE_DISABLE_EXTERNAL_SKILLS: "true",
    OPENCODE_DISABLE_LSP_DOWNLOAD: "true",
    OPENCODE_DISABLE_DEFAULT_PLUGINS: "true",
    OPENCODE_DISABLE_EMBEDDED_WEB_UI: "true",
    OPENCODE_DISABLE_SHARE: "true",
  }
  if (useBundledNativePicker) {
    delete openCodeEnvironment.OPENCODE_MODEL_DISPATCH_PICKER
    delete openCodeEnvironment.OPENCODE_MODEL_DISPATCH_PICKER_EVIDENCE
  } else {
    openCodeEnvironment.OPENCODE_MODEL_DISPATCH_PICKER = pickerPath
    openCodeEnvironment.OPENCODE_MODEL_DISPATCH_PICKER_EVIDENCE = pickerEvidencePath
  }
  if (npmRegistry) {
    openCodeEnvironment.BUN_CONFIG_REGISTRY = npmRegistry.baseURL
    openCodeEnvironment.NPM_CONFIG_REGISTRY = npmRegistry.baseURL
    openCodeEnvironment.npm_config_registry = npmRegistry.baseURL
  }

  if (useTui) {
    await assertUtilLinuxScript()
    await writeFile(tuiLauncherPath, tuiLauncherSource(), "utf8")
    await chmod(tuiLauncherPath, 0o755)
    openCodeEnvironment.TERM = "xterm-256color"
    openCodeEnvironment.COLORTERM = "truecolor"
    openCodeEnvironment.MODEL_DISPATCH_TUI_OPENCODE_BIN = opencode
    openCodeEnvironment.MODEL_DISPATCH_TUI_PROJECT = project
    openCodeEnvironment.MODEL_DISPATCH_TUI_PORT = String(port)
    openCodeEnvironment.MODEL_DISPATCH_TUI_LAUNCHER = tuiLauncherPath
  }

  child = Bun.spawn(
    useTui
      ? [
          "script",
          "--quiet",
          "--return",
          "--flush",
          "--command",
          'exec "$MODEL_DISPATCH_TUI_LAUNCHER"',
          "/dev/null",
        ]
      : [
          opencode,
          "serve",
          "--hostname",
          "127.0.0.1",
          "--port",
          String(port),
          "--print-logs",
          "--log-level",
          "DEBUG",
        ],
    {
      cwd: project,
      env: openCodeEnvironment,
      stdin: useTui ? "pipe" : "ignore",
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  stdoutCapture = captureOutput(child.stdout as ReadableStream<Uint8Array>)
  stdoutText = stdoutCapture.done
  stderrText = captureOutput(child.stderr as ReadableStream<Uint8Array>).done

  const ids = await waitForToolIDs(port, project, child)
  assert(
    ids.includes("configure_model_dispatch"),
    `Real OpenCode server loaded without configure_model_dispatch; tool ids: ${ids.join(", ")}`,
  )

  const client = createOpencodeClient({
    baseUrl: `http://127.0.0.1:${port}`,
    directory: project,
  })
  let parent: { id: string }
  let parentMessages: unknown[]
  if (useTui) {
    await waitForTuiPrompt(stdoutCapture, child)
    await sendTuiInput(child, `${parentPrompt}\r`)
    parent = await waitForTuiParentSession(client, child)
    parentMessages = await waitForCompletedParentMessages(
      client,
      parent.id,
      child,
    )
    assert(
      parentMessages.some((message) =>
        asRecord(asRecord(message).info).role === "user" &&
        messageText(message).includes(parentPrompt)
      ),
      "The PTY-entered TUI prompt was not persisted as the real parent user message",
    )
  } else {
    parent = apiData(await client.session.create({
      model: { providerID: PROVIDER_ID, id: PARENT_MODEL_ID },
    }), "create parent session")

    apiData(await withTimeout(
      client.session.prompt({
        sessionID: parent.id,
        model: { providerID: PROVIDER_ID, modelID: PARENT_MODEL_ID },
        agent: "build",
        parts: [{
          type: "text",
          text: parentPrompt,
        }],
      }),
      PARENT_PROMPT_TIMEOUT_MS,
      `Real OpenCode parent prompt did not complete within ${PARENT_PROMPT_TIMEOUT_MS / 1_000} seconds`,
    ), "prompt parent session")

    parentMessages = apiData(
      await client.session.messages({ sessionID: parent.id }),
      "read parent messages",
    )
  }
  if (testTwoTaskBatch) {
    await assertConcurrentBatchDispatch(
      client,
      parent.id,
      parentMessages,
      testBatchOverride ? OVERRIDE_VARIANT : SELECTED_VARIANT,
    )
    if (testConcurrentSameAgentFifo) {
      const pickerEvidence = JSON.parse(await readFile(pickerEvidencePath, "utf8")) as unknown
      assertConcurrentPickerEvidence(pickerEvidence)
    }
    assertChildLLMRequest(
      llm.requests,
      CHILD_PROMPT,
      "first same-agent child request",
      CHILD_MODEL_ID,
    )
    assertChildLLMRequest(
      llm.requests,
      SECOND_CHILD_PROMPT,
      "second same-agent child request",
      SECOND_CHILD_MODEL_ID,
      testBatchOverride ? OVERRIDE_VARIANT : SELECTED_VARIANT,
    )
  } else {
    const taskPart = findCompletedTaskPart(parentMessages)
    await assertCompletedTaskDispatch(
      client,
      parent.id,
      taskPart,
      CHILD_PROMPT,
      CHILD_MODEL_ID,
      "task",
    )
    if (!useBundledNativePicker) {
      const pickerEvidence = JSON.parse(await readFile(pickerEvidencePath, "utf8")) as unknown
      assertPickerEvidence(pickerEvidence, taskPart.callID)
    }
    assertChildLLMRequest(llm.requests, CHILD_PROMPT, "initial child request", CHILD_MODEL_ID)
  }
  npmRegistry?.assertInstalled()

  // OpenCode 1.18.7's legacy prompt path ignores currentModel().variant on a later turn,
  // while its v2 runner cannot resolve config-only provider models. Assert persistence
  // through both session projections and the durable model-switch event instead.

  if (useTui) {
    await sendTuiInput(child, "\u0004")
    await Promise.race([
      child.exited,
      Bun.sleep(2_000),
    ])
  }
  await stopChild(child)
  const [capturedStdout] = await Promise.all([stdoutText, stderrText])
  if (useTui) {
    assert(
      capturedStdout.includes("\u001b["),
      "OpenCode TUI did not emit terminal control frames through the PTY",
    )
  }
  console.log(
    testConcurrentSameAgentFifo
      ? `OpenCode same-agent FIFO integration passed: ${OPENCODE_VERSION} dispatched two concurrent real built-in tasks for general to ${PROVIDER_ID}/${CHILD_MODEL_ID}:${SELECTED_VARIANT} then ${PROVIDER_ID}/${SECOND_CHILD_MODEL_ID}:${SELECTED_VARIANT} without swapping (${opencode})`
      : testBatchOverride
        ? `OpenCode integration passed: ${OPENCODE_VERSION} loaded ${installedPluginPackage ? "the installed npm package by its documented package name" : "the worktree plugin"} and dispatched two real built-in tasks${useTui ? " from a prompt entered through its PTY-backed TUI" : ""} through the bundled native picker to global ${PROVIDER_ID}/${CHILD_MODEL_ID}:${SELECTED_VARIANT} and row override ${PROVIDER_ID}/${SECOND_CHILD_MODEL_ID}:${OVERRIDE_VARIANT}, including task metadata and child-session persistence (${opencode})`
        : `OpenCode integration passed: ${OPENCODE_VERSION} loaded ${installedPluginPackage ? "the installed npm package by its documented package name" : "the worktree plugin"} and dispatched a real built-in task${useTui ? " from a prompt entered through its PTY-backed TUI" : ""} to ${PROVIDER_ID}/${CHILD_MODEL_ID}:${SELECTED_VARIANT}, including task metadata and child-session persistence${useBundledNativePicker ? " through the bundled native picker" : ""} (${opencode})`,
  )
} catch (error) {
  if (child && child.exitCode === null) await stopChild(child)
  if (child) {
    const [stdout, stderr] = await Promise.all([
      stdoutText?.catch(() => "") ?? "",
      stderrText?.catch(() => "") ?? "",
    ])
    if (stdout) console.error(stdout.slice(-12_000))
    if (stderr) console.error(stderr.slice(-12_000))
  }
  if (llm?.requests.length) {
    console.error(`Captured fake LLM request summary:\n${JSON.stringify(
      llm.requests.map(({ path, body }) => ({
        path,
        model: body.model,
        reasoning_effort: body.reasoning_effort,
        reasoningEffort: body.reasoningEffort,
        initialChild: JSON.stringify(body).includes(CHILD_PROMPT),
        keys: Object.keys(body),
      })),
      null,
      2,
    )}`)
  }
  if (!useBundledNativePicker) {
    try {
      console.error(`Captured fake picker request:\n${await readFile(pickerEvidencePath, "utf8")}`)
    } catch {
      // The absence of evidence is itself useful when the picker failed before receiving start.
    }
  }
  if (npmRegistry?.requests.length) {
    console.error(
      `Captured local npm registry requests:\n${npmRegistry.requests.join("\n")}`,
    )
  }
  throw error
} finally {
  llm?.server.stop(true)
  npmRegistry?.server.stop(true)
  await rm(work, { recursive: true, force: true })
}

interface CapturedLLMRequest {
  path: string
  body: Record<string, unknown>
}

interface OutputCapture {
  done: Promise<string>
  snapshot(): string
}

function captureOutput(stream: ReadableStream<Uint8Array>): OutputCapture {
  const decoder = new TextDecoder()
  let output = ""
  const append = (value: string) => {
    output += value
    if (output.length > 4_000_000) output = output.slice(-4_000_000)
  }
  const done = (async () => {
    const reader = stream.getReader()
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        append(decoder.decode(chunk.value, { stream: true }))
      }
      append(decoder.decode())
      return output
    } finally {
      reader.releaseLock()
    }
  })()
  return {
    done,
    snapshot: () => output,
  }
}

async function assertUtilLinuxScript(): Promise<void> {
  const executable = Bun.which("script")
  assert(executable, "Real OpenCode TUI automation requires GNU script from util-linux")
  const child = Bun.spawnSync([executable, "--version"], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const version = `${child.stdout.toString()}\n${child.stderr.toString()}`
  assert(
    child.exitCode === 0 && version.includes("util-linux"),
    `Real OpenCode TUI automation requires GNU script from util-linux; received ${JSON.stringify(version.trim())}`,
  )
}

function tuiLauncherSource(): string {
  return [
    "#!/bin/sh",
    "set -eu",
    "stty rows 40 cols 120",
    'exec "$MODEL_DISPATCH_TUI_OPENCODE_BIN" "$MODEL_DISPATCH_TUI_PROJECT" \\',
    '  --hostname 127.0.0.1 --port "$MODEL_DISPATCH_TUI_PORT" \\',
    `  --model ${PROVIDER_ID}/${PARENT_MODEL_ID} --agent build`,
    "",
  ].join("\n")
}

async function waitForTuiPrompt(
  capture: OutputCapture,
  processHandle: ReturnType<typeof Bun.spawn>,
): Promise<void> {
  const deadline = Date.now() + TUI_READY_TIMEOUT_MS
  const markers = [PARENT_MODEL_ID, "Ask anything"]
  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null) {
      throw new Error(
        `OpenCode TUI exited before its prompt became ready (exit ${processHandle.exitCode})\nPTY tail:\n${capture.snapshot().slice(-12_000)}`,
      )
    }
    if (markers.some((marker) => capture.snapshot().includes(marker))) return
    await Bun.sleep(50)
  }
  throw new Error(
    `OpenCode TUI prompt did not render within ${TUI_READY_TIMEOUT_MS / 1_000} seconds\nPTY tail:\n${capture.snapshot().slice(-12_000)}`,
  )
}

async function sendTuiInput(
  processHandle: ReturnType<typeof Bun.spawn>,
  text: string,
): Promise<void> {
  const input = processHandle.stdin as unknown as {
    write(value: string): number
    flush(): number | Promise<number>
  } | undefined
  assert(input && typeof input.write === "function", "OpenCode PTY input is unavailable")
  input.write(text)
  await input.flush()
}

async function waitForTuiParentSession(
  client: ReturnType<typeof createOpencodeClient>,
  processHandle: ReturnType<typeof Bun.spawn>,
): Promise<{ id: string }> {
  const deadline = Date.now() + PARENT_PROMPT_TIMEOUT_MS
  let lastError: unknown
  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null) {
      throw new Error(
        `OpenCode TUI exited before persisting the entered prompt (exit ${processHandle.exitCode})`,
      )
    }
    try {
      const sessions = apiData(
        await client.session.list({ roots: true, limit: 20 }),
        "list TUI sessions",
      )
      const parent = sessions.find((session) => !session.parentID)
      if (parent?.id) return parent
    } catch (error) {
      lastError = error
    }
    await Bun.sleep(100)
  }
  throw new Error(
    `OpenCode TUI did not persist a root session within ${PARENT_PROMPT_TIMEOUT_MS / 1_000} seconds: ${String(lastError)}`,
  )
}

async function waitForCompletedParentMessages(
  client: ReturnType<typeof createOpencodeClient>,
  sessionID: string,
  processHandle: ReturnType<typeof Bun.spawn>,
): Promise<unknown[]> {
  const deadline = Date.now() + PARENT_PROMPT_TIMEOUT_MS
  let lastError: unknown
  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null) {
      throw new Error(
        `OpenCode TUI exited before task dispatch completed (exit ${processHandle.exitCode})`,
      )
    }
    try {
      const messages = apiData(
        await client.session.messages({ sessionID }),
        "read TUI parent messages",
      )
      const expectedTaskCount = testTwoTaskBatch ? 2 : 1
      if (completedTaskParts(messages).length >= expectedTaskCount) {
        return messages
      }
    } catch (error) {
      lastError = error
    }
    await Bun.sleep(100)
  }
  throw new Error(
    `OpenCode TUI task dispatch did not complete within ${PARENT_PROMPT_TIMEOUT_MS / 1_000} seconds: ${String(lastError)}`,
  )
}

async function writePluginShim(entry: string, destination: string): Promise<void> {
  await access(entry, constants.R_OK)
  const moduleURL = pathToFileURL(entry).href
  await writeFile(
    destination,
    `export { default } from ${JSON.stringify(moduleURL)}\nexport * from ${JSON.stringify(moduleURL)}\n`,
    "utf8",
  )
}

async function seedLocalPluginRuntime(directory: string): Promise<void> {
  const dependencies = { "@opencode-ai/plugin": PINNED_OPENCODE_VERSION }
  await mkdir(join(directory, "node_modules"), { recursive: true })
  await Promise.all([
    writeFile(
      join(directory, "package.json"),
      `${JSON.stringify({ private: true, dependencies }, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      join(directory, "package-lock.json"),
      `${JSON.stringify({
        name: ".opencode",
        lockfileVersion: 3,
        requires: true,
        packages: { "": { dependencies } },
      }, null, 2)}\n`,
      "utf8",
    ),
  ])
}

interface FakeLLM {
  server: Bun.Server<undefined>
  baseURL: string
  requests: CapturedLLMRequest[]
}

function startFakeLLM(port: number): FakeLLM {
  const requests: CapturedLLMRequest[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    async fetch(request) {
      const url = new URL(request.url)
      if (request.method !== "POST" || url.pathname !== "/v1/chat/completions") {
        return Response.json({ error: `Unexpected fake LLM endpoint ${request.method} ${url.pathname}` }, { status: 404 })
      }

      const value: unknown = await request.json()
      const body = asRecord(value)
      requests.push({ path: url.pathname, body })
      const serialized = JSON.stringify(body)
      if (serialized.includes("Generate a title for this conversation")) {
        return chatTextResponse("Dispatch integration")
      }

      const model = readString(body, "model")
      if (model === PARENT_MODEL_ID && hasToolResult(body)) {
        return chatTextResponse(
          testTwoTaskBatch
            ? "parent received both deterministic child results"
            : "parent received deterministic child result",
        )
      }
      if (
        model === PARENT_MODEL_ID &&
        (serialized.includes(CHILD_PROMPT) || serialized.includes(SECOND_CHILD_PROMPT))
      ) {
        // Let a technical-failure fallback finish deterministically so the
        // assertions report the wrong model instead of recursively requesting
        // another task until the integration timeout.
        return chatTextResponse("deterministic fallback child marker")
      }
      if (model === PARENT_MODEL_ID) {
        if (testTwoTaskBatch) {
          return chatToolResponses([
            {
              id: FIRST_TASK_CALL_ID,
              name: "task",
              args: {
                description: "deterministic first dispatch",
                prompt: CHILD_PROMPT,
                subagent_type: "general",
              },
            },
            {
              id: SECOND_TASK_CALL_ID,
              name: "task",
              args: {
                description: "deterministic second dispatch",
                prompt: SECOND_CHILD_PROMPT,
                subagent_type: "general",
              },
            },
          ])
        }
        return chatToolResponse("task", {
          description: "deterministic dispatch",
          prompt: CHILD_PROMPT,
          subagent_type: "general",
        })
      }
      if (model === CHILD_MODEL_ID) {
        return chatTextResponse("deterministic child marker")
      }
      if (model === SECOND_CHILD_MODEL_ID) {
        return chatTextResponse("deterministic second child marker")
      }
      return Response.json({ error: `Unexpected fake LLM model ${String(model)}` }, { status: 400 })
    },
  })
  return {
    server,
    baseURL: `http://127.0.0.1:${server.port}/v1`,
    requests,
  }
}

function chatToolResponse(name: string, args: Record<string, unknown>): Response {
  return chatToolResponses([{
    id: "call_dispatch_integration",
    name,
    args,
  }])
}

function chatToolResponses(
  calls: Array<{ id: string; name: string; args: Record<string, unknown> }>,
): Response {
  return chatResponse([
    chatChunk({ role: "assistant" }),
    chatChunk({
      tool_calls: calls.map((call, index) => ({
        index,
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: JSON.stringify(call.args) },
      })),
    }),
    chatChunk({}, "tool_calls"),
  ])
}

function chatTextResponse(text: string): Response {
  return chatResponse([
    chatChunk({ role: "assistant" }),
    chatChunk({ content: text }),
    chatChunk({}, "stop"),
  ])
}

function chatChunk(delta: Record<string, unknown>, finishReason?: string): Record<string, unknown> {
  return {
    id: "chatcmpl-model-dispatch",
    object: "chat.completion.chunk",
    choices: [{
      index: 0,
      delta,
      ...(finishReason ? { finish_reason: finishReason } : {}),
    }],
    ...(finishReason ? {
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      },
    } : {}),
  }
}

function chatResponse(chunks: Array<Record<string, unknown>>): Response {
  const payload = [
    ...chunks.map((chunk) => `data: ${JSON.stringify(chunk)}`),
    "data: [DONE]",
  ].join("\n\n") + "\n\n"
  return new Response(payload, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  })
}

function hasToolResult(body: Record<string, unknown>): boolean {
  return Array.isArray(body.messages) && body.messages.some((message) => asRecord(message).role === "tool")
}

function openCodeConfig(
  baseURL: string,
  loadInstalledPackageByName: boolean,
): Record<string, unknown> {
  return {
    $schema: "https://opencode.ai/config.json",
    autoupdate: false,
    ...(loadInstalledPackageByName
      ? { plugin: ["opencode-model-dispatch"] }
      : {}),
    model: `${PROVIDER_ID}/${PARENT_MODEL_ID}`,
    small_model: `${PROVIDER_ID}/${PARENT_MODEL_ID}`,
    enabled_providers: [PROVIDER_ID],
    permission: {
      task: {
        "*": "deny",
        general: "allow",
      },
    },
    provider: {
      [PROVIDER_ID]: {
        name: "Local dispatch integration provider",
        npm: "@ai-sdk/openai-compatible",
        env: [],
        options: {
          apiKey: "local-integration-key",
          baseURL,
        },
        models: {
          [PARENT_MODEL_ID]: {
            name: "Parent integration model",
            tool_call: true,
            limit: { context: 16_384, output: 2_048 },
          },
          [CHILD_MODEL_ID]: {
            name: "Child integration model",
            reasoning: true,
            tool_call: true,
            limit: { context: 16_384, output: 2_048 },
            variants: {
              [SELECTED_VARIANT]: { reasoningEffort: SELECTED_VARIANT },
            },
          },
          ...(testTwoTaskBatch
            ? {
                [SECOND_CHILD_MODEL_ID]: {
                  name: "Second child integration model",
                  reasoning: true,
                  tool_call: true,
                  limit: { context: 16_384, output: 2_048 },
                  variants: {
                    [SELECTED_VARIANT]: {
                      reasoningEffort: SELECTED_VARIANT,
                    },
                    ...(testBatchOverride
                      ? {
                          [OVERRIDE_VARIANT]: {
                            reasoningEffort: OVERRIDE_VARIANT,
                          },
                        }
                      : {}),
                  },
                },
              }
            : {}),
        },
      },
    },
  }
}

function fakePickerSource(): string {
  return `#!${process.execPath}
import { writeFileSync } from "node:fs"
import { createInterface } from "node:readline"

const providerID = ${JSON.stringify(PROVIDER_ID)}
const modelIDs = ${JSON.stringify(
    testConcurrentSameAgentFifo
      ? [CHILD_MODEL_ID, SECOND_CHILD_MODEL_ID]
      : [CHILD_MODEL_ID],
  )}
const variant = ${JSON.stringify(SELECTED_VARIANT)}
const evidencePath = process.env.OPENCODE_MODEL_DISPATCH_PICKER_EVIDENCE

process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "ready" }) + "\\n")
const input = createInterface({ input: process.stdin, crlfDelay: Infinity })
input.once("line", (line) => {
  const message = JSON.parse(line)
  const request = message.params
  const provider = request?.catalog?.find((candidate) => candidate.providerID === providerID)
  const rows = request?.rows ?? []
  if (rows.length !== modelIDs.length) {
    throw new Error("Real task hook did not provide the expected picker rows")
  }
  const selections = rows.map((row, index) => {
    const modelID = modelIDs[index]
    const model = provider?.models?.find((candidate) => candidate.modelID === modelID)
    if (!model?.variants?.includes(variant)) {
      throw new Error("Selected effort was not advertised by the real OpenCode model catalog")
    }
    if (!row?.callID || row.agentName !== "general") {
      throw new Error("Real task hook did not provide the expected picker row")
    }
    return { callID: row.callID, providerID, modelID, variant }
  })
  if (evidencePath) {
    writeFileSync(evidencePath, JSON.stringify({
      request,
      selections,
      ...(selections.length === 1 ? { selection: selections[0] } : {}),
    }, null, 2))
  }
  process.stdout.write(JSON.stringify({
    jsonrpc: "2.0",
    method: "started",
  }) + "\\n")
  process.stdout.write(JSON.stringify({
    jsonrpc: "2.0",
    method: "submit",
    params: { selections },
  }) + "\\n")
})
`
}

function findCompletedTaskPart(messages: unknown[]): Record<string, unknown> {
  const part = completedTaskPart(messages)
  if (part) return part
  throw new Error(`Real parent session has no completed built-in task part: ${JSON.stringify(messages)}`)
}

function completedTaskPart(messages: unknown[]): Record<string, unknown> | undefined {
  return completedTaskParts(messages)[0]
}

function completedTaskParts(messages: unknown[]): Record<string, unknown>[] {
  const completed: Record<string, unknown>[] = []
  for (const message of messages) {
    const parts = asRecord(message).parts
    if (!Array.isArray(parts)) continue
    for (const part of parts) {
      const value = asRecord(part)
      if (
        value.type === "tool" &&
        value.tool === "task" &&
        asRecord(value.state).status === "completed"
      ) {
        completed.push(value)
      }
    }
  }
  return completed
}

async function assertConcurrentBatchDispatch(
  client: ReturnType<typeof createOpencodeClient>,
  parentSessionID: string,
  messages: unknown[],
  secondExpectedVariant: string,
): Promise<void> {
  const taskParts = completedTaskParts(messages)
  assert(
    taskParts.length === 2,
    `Expected exactly two completed real built-in task parts, received ${taskParts.length}: ${JSON.stringify(taskParts)}`,
  )
  const firstTask = taskParts.find((part) => part.callID === FIRST_TASK_CALL_ID)
  const secondTask = taskParts.find((part) => part.callID === SECOND_TASK_CALL_ID)
  assert(
    firstTask && secondTask,
    `Real OpenCode did not preserve both concurrent task call identities: ${JSON.stringify(taskParts.map((part) => part.callID))}`,
  )

  const firstChildSessionID = await assertCompletedTaskDispatch(
    client,
    parentSessionID,
    firstTask,
    CHILD_PROMPT,
    CHILD_MODEL_ID,
    "first same-agent task",
  )
  const secondChildSessionID = await assertCompletedTaskDispatch(
    client,
    parentSessionID,
    secondTask,
    SECOND_CHILD_PROMPT,
    SECOND_CHILD_MODEL_ID,
    "second same-agent task",
    secondExpectedVariant,
  )
  assert(
    firstChildSessionID !== secondChildSessionID,
    "Both concurrent built-in task calls unexpectedly resolved to the same child session",
  )
}

async function assertCompletedTaskDispatch(
  client: ReturnType<typeof createOpencodeClient>,
  parentSessionID: string,
  taskPart: Record<string, unknown>,
  expectedPrompt: string,
  expectedModelID: string,
  label: string,
  expectedVariant = SELECTED_VARIANT,
): Promise<string> {
  const taskMetadata = asRecord(asRecord(taskPart.state).metadata)
  assertSelection(
    asRecord(taskMetadata.model),
    `${label} completed metadata`,
    "modelID",
    expectedModelID,
    expectedVariant,
  )

  const childSessionID = readString(taskMetadata, "sessionId")
  assert(
    childSessionID,
    `${label} metadata omitted the child session id: ${JSON.stringify(taskMetadata)}`,
  )
  const children = apiData(
    await client.session.children({ sessionID: parentSessionID }),
    `read ${label} child sessions`,
  )
  const childSession = children.find((candidate) => candidate.id === childSessionID)
  assert(
    childSession,
    `${label} child ${childSessionID} was not returned by the real session children endpoint`,
  )
  assertSelection(
    asRecord(childSession.model),
    `${label} persisted child session model`,
    "id",
    expectedModelID,
    expectedVariant,
  )

  const v2ChildEnvelope = apiData(
    await client.v2.session.get({ sessionID: childSessionID }),
    `read ${label} v2 child session`,
  )
  const v2Child = asRecord(asRecord(v2ChildEnvelope).data)
  assertSelection(
    asRecord(v2Child.model),
    `${label} v2 persisted child session model`,
    "id",
    expectedModelID,
    expectedVariant,
  )
  const v2History = apiData(
    await client.v2.session.history({ sessionID: childSessionID, limit: 50 }),
    `read ${label} v2 child session history`,
  )
  const historyData = asRecord(v2History).data
  const v2Events: unknown[] = Array.isArray(historyData) ? historyData : []
  const modelSwitch = v2Events
    .map(asRecord)
    .find((event) => event.type === "session.next.model.switched")
  assert(modelSwitch, `${label} v2 history omitted the plugin's persisted model-switch event`)
  assertSelection(
    asRecord(asRecord(modelSwitch.data).model),
    `${label} v2 persisted model-switch event`,
    "id",
    expectedModelID,
    expectedVariant,
  )

  const childMessages = apiData(
    await client.session.messages({ sessionID: childSessionID }),
    `read ${label} child messages`,
  )
  const firstChildUser = childMessages.find((message) => {
    const info = asRecord(message.info)
    return info.role === "user" && messageText(message).includes(expectedPrompt)
  })
  assert(
    firstChildUser,
    `${label} did not create its expected real child-session prompt`,
  )
  assertSelection(
    asRecord(asRecord(firstChildUser.info).model),
    `${label} child user-message model`,
    "modelID",
    expectedModelID,
    expectedVariant,
  )
  return childSessionID
}

function assertPickerEvidence(value: unknown, taskCallID: unknown): void {
  const evidence = asRecord(value)
  const request = asRecord(evidence.request)
  const selection = asRecord(evidence.selection)
  const rows = Array.isArray(request.rows) ? request.rows : []
  const row = asRecord(rows[0])
  assert(row.agentName === "general", `Picker did not receive the real general-agent task row: ${JSON.stringify(value)}`)
  assert(
    selection.callID === row.callID && selection.callID === taskCallID,
    `Picker selection was not tied to the persisted real task call: ${JSON.stringify(value)}`,
  )
  assertSelection(selection, "fake picker selection")

  const providers = Array.isArray(request.catalog) ? request.catalog : []
  const provider = providers.map(asRecord).find((candidate) => candidate.providerID === PROVIDER_ID)
  const models = Array.isArray(provider?.models) ? provider.models : []
  const selectedModel = models.map(asRecord).find((candidate) => candidate.modelID === CHILD_MODEL_ID)
  assert(
    Array.isArray(selectedModel?.variants) && selectedModel.variants.includes(SELECTED_VARIANT),
    `Picker selected a variant that the real catalog did not advertise: ${JSON.stringify(value)}`,
  )
}

function assertConcurrentPickerEvidence(value: unknown): void {
  const evidence = asRecord(value)
  const request = asRecord(evidence.request)
  const rows = Array.isArray(request.rows) ? request.rows.map(asRecord) : []
  const selections = Array.isArray(evidence.selections)
    ? evidence.selections.map(asRecord)
    : []
  assert(
    rows.length === 2 &&
      rows[0]?.callID === FIRST_TASK_CALL_ID &&
      rows[1]?.callID === SECOND_TASK_CALL_ID &&
      rows.every((row) => row.agentName === "general"),
    `The real concurrent same-agent task calls did not reach one picker batch in FIFO order: ${JSON.stringify(value)}`,
  )
  assert(
    selections.length === 2 &&
      selections[0]?.callID === FIRST_TASK_CALL_ID &&
      selections[0]?.modelID === CHILD_MODEL_ID &&
      selections[1]?.callID === SECOND_TASK_CALL_ID &&
      selections[1]?.modelID === SECOND_CHILD_MODEL_ID,
    `The deterministic picker did not assign distinct models in FIFO call order: ${JSON.stringify(value)}`,
  )
  for (const [index, selection] of selections.entries()) {
    assertSelection(
      selection,
      `same-agent picker selection ${index + 1}`,
      "modelID",
      index === 0 ? CHILD_MODEL_ID : SECOND_CHILD_MODEL_ID,
    )
  }
}

function assertChildLLMRequest(
  requests: CapturedLLMRequest[],
  prompt: string,
  label: string,
  expectedModelID: string,
  expectedVariant = SELECTED_VARIANT,
): void {
  const matchingChildRequests = requests.filter((candidate) => {
    const serialized = JSON.stringify(candidate.body)
    return candidate.body.model !== PARENT_MODEL_ID && serialized.includes(prompt)
  })
  assert(
    matchingChildRequests.length === 1,
    `Fake LLM expected exactly one ${label}, received ${matchingChildRequests.length}`,
  )
  const request = matchingChildRequests[0]!
  assert(
    request.body.model === expectedModelID,
    `${label} was swapped to ${String(request.body.model)} instead of ${expectedModelID}: ${JSON.stringify(request.body)}`,
  )
  assert(
    request.body.reasoning_effort === expectedVariant,
    `${label} reached ${expectedModelID} without reasoning_effort=${expectedVariant}: ${JSON.stringify(request.body)}`,
  )
}

function assertSelection(
  value: Record<string, unknown>,
  label: string,
  modelIDKey = "modelID",
  expectedModelID = CHILD_MODEL_ID,
  expectedVariant = SELECTED_VARIANT,
): void {
  assert(
    value.providerID === PROVIDER_ID &&
      value[modelIDKey] === expectedModelID &&
      value.variant === expectedVariant,
    `${label} did not preserve ${PROVIDER_ID}/${expectedModelID}:${expectedVariant}: ${JSON.stringify(value)}`,
  )
}

function messageText(message: unknown): string {
  const parts = asRecord(message).parts
  if (!Array.isArray(parts)) return ""
  return parts
    .map((part) => asRecord(part))
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
}

function apiData<T>(result: { data?: T; error?: unknown }, operation: string): T {
  if (result.error !== undefined) {
    throw new Error(`OpenCode failed to ${operation}: ${JSON.stringify(result.error)}`)
  }
  if (result.data === undefined) {
    throw new Error(`OpenCode returned no data while attempting to ${operation}`)
  }
  return result.data
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function readString(value: Record<string, unknown>, key: string): string | undefined {
  return typeof value[key] === "string" ? value[key] : undefined
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function waitForToolIDs(
  port: number,
  directory: string,
  processHandle: ReturnType<typeof Bun.spawn>,
): Promise<string[]> {
  const endpoint = new URL(`http://127.0.0.1:${port}/experimental/tool/ids`)
  endpoint.searchParams.set("directory", directory)
  const deadline = Date.now() + OPENCODE_STARTUP_TIMEOUT_MS
  let lastError: unknown

  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null) {
      throw new Error(`OpenCode exited before its server became ready (exit ${processHandle.exitCode})`)
    }
    try {
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(1_000) })
      if (response.ok) {
        const value: unknown = await response.json()
        if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
          return value
        }
        lastError = new Error(`Unexpected tool id response: ${JSON.stringify(value)}`)
      } else {
        lastError = new Error(`OpenCode returned HTTP ${response.status}`)
      }
    } catch (error) {
      lastError = error
    }
    await Bun.sleep(100)
  }

  throw new Error(
    `OpenCode server did not become ready within ${OPENCODE_STARTUP_TIMEOUT_MS / 1_000} seconds: ${String(lastError)}`,
  )
}

async function stopChild(processHandle: ReturnType<typeof Bun.spawn>): Promise<void> {
  if (processHandle.exitCode !== null) return
  processHandle.kill()
  const stopped = await Promise.race([
    processHandle.exited.then(() => true),
    Bun.sleep(3_000).then(() => false),
  ])
  if (!stopped && processHandle.exitCode === null) {
    processHandle.kill(9)
    await processHandle.exited
  }
}

async function reservePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Could not reserve an OpenCode test port")
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return address.port
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

async function assertOpenCodeVersion(opencode: string): Promise<void> {
  const result = Bun.spawnSync([opencode, "--version"], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const stdout = result.stdout.toString().trim()
  const stderr = result.stderr.toString().trim()
  assert(
    result.exitCode === 0 && stdout === OPENCODE_VERSION,
    `OpenCode integration requires exactly ${OPENCODE_VERSION}; ${opencode} returned exit ${result.exitCode}, stdout=${JSON.stringify(stdout)}, stderr=${JSON.stringify(stderr)}`,
  )
}

function expectedOpenCodeVersion(): string {
  const explicit = process.env.OPENCODE_TEST_VERSION
  if (explicit === undefined) return PINNED_OPENCODE_VERSION
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(explicit)) {
    throw new Error(
      "OPENCODE_TEST_VERSION must be an exact stable x.y.z version",
    )
  }
  return explicit
}

async function resolveOpenCodeBinary(): Promise<string> {
  const explicit = process.env.OPENCODE_BIN
  if (explicit) {
    await access(explicit, constants.X_OK)
    return explicit
  }

  const packageName = platformPackageName()
  const executable = process.platform === "win32" ? "opencode.exe" : "opencode"
  const candidates = [
    join(root, "node_modules", packageName, "bin", executable),
    join(root, "node_modules", "opencode-ai", "node_modules", packageName, "bin", executable),
    join("/usr/lib/node_modules/opencode-ai/node_modules", packageName, "bin", executable),
    Bun.which("opencode"),
  ].filter((candidate): candidate is string => Boolean(candidate))

  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK)
      return candidate
    } catch {
      // Try the next supported installation layout.
    }
  }

  throw new Error(
    `OpenCode ${OPENCODE_VERSION} integration binary not found. Set OPENCODE_BIN or install opencode-ai@${OPENCODE_VERSION}.`,
  )
}

function platformPackageName(): string {
  const platform = process.platform === "darwin" ? "darwin" : process.platform
  if (!["darwin", "linux", "win32"].includes(platform)) {
    throw new Error(`OpenCode integration is unsupported on ${process.platform}`)
  }
  const packagePlatform = platform === "win32" ? "windows" : platform
  return `opencode-${packagePlatform}-${process.arch}`
}
