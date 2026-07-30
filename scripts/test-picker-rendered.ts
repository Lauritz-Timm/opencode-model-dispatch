import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { constants } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { basename, isAbsolute, join } from "node:path"
import { fileURLToPath } from "node:url"

import { terminateDetachedProcessGroup } from "./installed-native-opencode-support"

interface RenderedUiResult {
  ok?: unknown
  assertions?: unknown
  measurements?: unknown
  error?: unknown
}

const root = fileURLToPath(new URL("../", import.meta.url))
const work = await mkdtemp(join(tmpdir(), "model-dispatch-rendered-ui-"))
const vitePort = await reservePort()
const callbackPort = await reservePort()
const networkSinkPort = await reservePort()
const callback = deferred<RenderedUiResult>()
let browser: ReturnType<typeof Bun.spawn> | undefined
let vite: ReturnType<typeof Bun.spawn> | undefined
let browserOutput = Promise.resolve("")
let viteOutput = Promise.resolve("")
const progress: string[] = []
let browserUsesProcessGroup = false

const callbackServer = Bun.serve({
  hostname: "127.0.0.1",
  port: callbackPort,
  async fetch(request) {
    const url = new URL(request.url)
    if (request.method === "POST" && url.pathname === "/progress") {
      const step = (await request.text()).trim()
      if (step.length > 0 && step.length <= 200) {
        progress.push(step)
      }
      return new Response("ok")
    }
    if (request.method !== "POST" || url.pathname !== "/result") {
      return new Response("Not found", { status: 404 })
    }
    const body = await request.text()
    if (new TextEncoder().encode(body).byteLength > 64 * 1024) {
      return new Response("Result too large", { status: 413 })
    }
    let result: RenderedUiResult
    try {
      result = JSON.parse(body) as RenderedUiResult
    } catch {
      return new Response("Invalid JSON", { status: 400 })
    }
    callback.resolve(result)
    return new Response("ok")
  },
})
const networkSink = Bun.serve({
  hostname: "127.0.0.1",
  port: networkSinkPort,
  fetch() {
    return new Response("Rendered UI tests are loopback-only", { status: 403 })
  },
})

try {
  await access(
    join(root, "picker", "node_modules", "vite", "bin", "vite.js"),
    constants.R_OK,
  )
  vite = Bun.spawn(
    [
      process.execPath,
      "run",
      "--cwd",
      join(root, "picker"),
      "dev",
      "--host",
      "127.0.0.1",
      "--port",
      String(vitePort),
      "--strictPort",
    ],
    {
      cwd: root,
      env: localOnlyEnvironment(process.env, networkSinkPort),
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  viteOutput = collectOutput(vite)
  await waitForVite(vitePort, vite)

  const browserCommand = await resolveBrowser()
  const profile = join(work, "browser-profile")
  await mkdir(profile)
  const callbackUrl = `http://127.0.0.1:${callbackServer.port}/result`
  const page = new URL(
    `http://127.0.0.1:${vitePort}/rendered-test.html`,
  )
  page.searchParams.set("callback", callbackUrl)
  const browserInvocation = await browserArguments(
    browserCommand,
    profile,
    page.href,
    networkSinkPort,
  )
  browser = Bun.spawn(await displayBrowserArguments(
    browserCommand,
    browserInvocation,
  ), {
    cwd: root,
    env: localOnlyEnvironment(process.env, networkSinkPort),
    stdout: "pipe",
    stderr: "pipe",
    detached: (browserUsesProcessGroup =
      basename(browserCommand).toLowerCase().includes("minibrowser")),
  })
  browserOutput = collectOutput(browser)

  const result = await withTimeout(
    Promise.race([
      callback.promise,
      browser.exited.then(async (code) => {
        throw new Error(
          `Rendered UI browser exited ${code} before reporting a result\n${await browserOutput}`,
        )
      }),
    ]),
    45_000,
    `Rendered UI browser did not report within 45 seconds (${browserCommand})`,
  )
  if (
    result.ok !== true ||
    typeof result.assertions !== "number" ||
    !Number.isSafeInteger(result.assertions) ||
    result.assertions < 1
  ) {
    throw new Error(
      `Rendered picker UI failed after ${String(result.assertions)} assertion(s): ${typeof result.error === "string" ? result.error : JSON.stringify(result)}`,
    )
  }
  console.log(
    `rendered picker integration passed: ${result.assertions} computed-style, responsive-layout, icon-absence, and keyboard assertions in ${basename(browserCommand)} ${JSON.stringify(result.measurements)}`,
  )
} catch (error) {
  await Promise.all([
    stopProcess(browser, browserUsesProcessGroup),
    stopProcess(vite),
  ])
  const [browserLog, viteLog] = await Promise.all([
    browserOutput.catch(() => ""),
    viteOutput.catch(() => ""),
  ])
  if (browserLog.trim()) {
    console.error(`Rendered UI browser output:\n${browserLog.slice(-8_000)}`)
  }
  if (viteLog.trim()) {
    console.error(`Rendered UI Vite output:\n${viteLog.slice(-8_000)}`)
  }
  console.error(
    `Rendered UI progress: ${progress.length > 0 ? progress.join(" -> ") : "no page callback received"}`,
  )
  throw error
} finally {
  callbackServer.stop(true)
  networkSink.stop(true)
  await Promise.all([
    stopProcess(browser, browserUsesProcessGroup),
    stopProcess(vite),
  ])
  await rm(work, { recursive: true, force: true })
}

async function resolveBrowser(): Promise<string> {
  const override = process.env.PICKER_RENDERED_BROWSER?.trim()
  if (override) {
    if (!isAbsolute(override)) {
      throw new Error("PICKER_RENDERED_BROWSER must be an absolute path")
    }
    await access(override, constants.X_OK)
    return override
  }

  for (const name of [
    "chromium",
    "chromium-browser",
    "google-chrome",
    "google-chrome-stable",
    "firefox",
  ]) {
    const candidate = Bun.which(name)
    if (candidate) return candidate
  }
  throw new Error(
    "Rendered UI integration requires an installed Chromium/Chrome or Firefox browser; set PICKER_RENDERED_BROWSER to an absolute local browser path",
  )
}

async function browserArguments(
  command: string,
  profile: string,
  page: string,
  networkSinkPort: number,
): Promise<string[]> {
  const name = basename(command).toLowerCase()
  if (name.includes("minibrowser")) {
    return [command, page]
  }
  if (name.includes("firefox")) {
    await writeFile(
      join(profile, "user.js"),
      [
        'user_pref("app.update.enabled", false);',
        'user_pref("browser.safebrowsing.downloads.enabled", false);',
        'user_pref("browser.safebrowsing.malware.enabled", false);',
        'user_pref("browser.safebrowsing.phishing.enabled", false);',
        'user_pref("datareporting.healthreport.uploadEnabled", false);',
        'user_pref("datareporting.policy.dataSubmissionEnabled", false);',
        'user_pref("network.captive-portal-service.enabled", false);',
        'user_pref("network.connectivity-service.enabled", false);',
        'user_pref("network.proxy.type", 1);',
        'user_pref("network.proxy.http", "127.0.0.1");',
        `user_pref("network.proxy.http_port", ${networkSinkPort});`,
        'user_pref("network.proxy.ssl", "127.0.0.1");',
        `user_pref("network.proxy.ssl_port", ${networkSinkPort});`,
        'user_pref("network.proxy.no_proxies_on", "localhost, 127.0.0.1");',
        'user_pref("toolkit.telemetry.enabled", false);',
        "",
      ].join("\n"),
      "utf8",
    )
    return [
      command,
      "--headless",
      "--new-instance",
      "--profile",
      profile,
      page,
    ]
  }

  return [
    command,
    "--headless=new",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-domain-reliability",
    "--disable-sync",
    "--metrics-recording-only",
    "--no-default-browser-check",
    "--no-first-run",
    `--proxy-server=http://127.0.0.1:${networkSinkPort}`,
    "--proxy-bypass-list=localhost;127.0.0.1",
    `--user-data-dir=${profile}`,
    "--window-size=1200,900",
    page,
  ]
}

async function displayBrowserArguments(
  browserCommand: string,
  invocation: string[],
): Promise<string[]> {
  if (!basename(browserCommand).toLowerCase().includes("minibrowser")) {
    return invocation
  }

  const override = process.env.PICKER_RENDERED_XVFB_RUN?.trim()
  if (override) {
    if (!isAbsolute(override)) {
      throw new Error("PICKER_RENDERED_XVFB_RUN must be an absolute path")
    }
    await access(override, constants.X_OK)
    return [
      override,
      "-a",
      "--server-args=-screen 0 1280x1024x24",
      ...invocation,
    ]
  }
  const xvfbRun = Bun.which("xvfb-run")
  if (xvfbRun) {
    return [
      xvfbRun,
      "-a",
      "--server-args=-screen 0 1280x1024x24",
      ...invocation,
    ]
  }
  if (process.env.DISPLAY) return invocation
  throw new Error(
    "MiniBrowser requires a display; install xvfb-run or set PICKER_RENDERED_XVFB_RUN to an absolute local wrapper path",
  )
}

function localOnlyEnvironment(
  source: Record<string, string | undefined>,
  networkSinkPort: number,
): Record<string, string | undefined> {
  const networkSink = `http://127.0.0.1:${networkSinkPort}`
  const environment = {
    ...source,
    HTTP_PROXY: networkSink,
    HTTPS_PROXY: networkSink,
    ALL_PROXY: networkSink,
    http_proxy: networkSink,
    https_proxy: networkSink,
    all_proxy: networkSink,
    NO_PROXY: "127.0.0.1,localhost",
    no_proxy: "127.0.0.1,localhost",
  }
  return environment
}

async function waitForVite(
  port: number,
  processHandle: ReturnType<typeof Bun.spawn>,
): Promise<void> {
  const endpoint = `http://127.0.0.1:${port}/rendered-test.html`
  const deadline = Date.now() + 20_000
  let lastError: unknown
  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null) {
      throw new Error(`Rendered UI Vite server exited ${processHandle.exitCode}`)
    }
    try {
      const response = await fetch(endpoint, {
        signal: AbortSignal.timeout(1_000),
      })
      if (response.ok) return
      lastError = new Error(`Vite returned HTTP ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await Bun.sleep(50)
  }
  throw new Error(`Rendered UI Vite server did not start: ${String(lastError)}`)
}

async function collectOutput(
  processHandle: ReturnType<typeof Bun.spawn>,
): Promise<string> {
  const [stdout, stderr] = await Promise.all([
    processHandle.stdout
      ? new Response(processHandle.stdout as ReadableStream<Uint8Array>).text()
      : "",
    processHandle.stderr
      ? new Response(processHandle.stderr as ReadableStream<Uint8Array>).text()
      : "",
  ])
  return `${stdout}\n${stderr}`.trim()
}

async function stopProcess(
  processHandle: ReturnType<typeof Bun.spawn> | undefined,
  detachedGroup = false,
): Promise<void> {
  if (!processHandle || processHandle.exitCode !== null) return
  if (detachedGroup && process.platform !== "win32") {
    await terminateDetachedProcessGroup(processHandle.pid)
    await processHandle.exited
    return
  }
  processHandle.kill()
  const exited = await Promise.race([
    processHandle.exited.then(() => true),
    Bun.sleep(5_000).then(() => false),
  ])
  if (!exited && processHandle.exitCode === null) {
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
  if (!address || typeof address === "string") {
    throw new Error("Could not reserve a rendered UI test port")
  }
  await new Promise<void>((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve()),
  )
  return address.port
}

function deferred<T>(): {
  promise: Promise<T>
  resolve(value: T): void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
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
