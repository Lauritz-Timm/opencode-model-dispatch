import { describe, expect, test } from "bun:test"

const root = new URL("../", import.meta.url)

async function sourceFiles(): Promise<Array<{ path: string; source: string }>> {
  const paths = [
    ...new Bun.Glob("src/**/*.ts").scanSync({ cwd: root.pathname }),
    ...new Bun.Glob("bin/**/*.js").scanSync({ cwd: root.pathname }),
    ...new Bun.Glob("picker/src/**/*.{ts,svelte}").scanSync({ cwd: root.pathname }),
  ]
  return await Promise.all(paths.map(async (path) => ({
    path,
    source: await Bun.file(new URL(path, root)).text(),
  })))
}

describe("local-only dispatch runtime", () => {
  test("runtime source has no independent outbound transport", async () => {
    const forbidden = [
      /\bfetch\s*\(/,
      /\bnew\s+WebSocket\s*\(/,
      /\bnew\s+EventSource\s*\(/,
      /\bXMLHttpRequest\b/,
      /\bsendBeacon\s*\(/,
      /from\s+["']node:https?["']/,
    ]

    for (const file of await sourceFiles()) {
      for (const pattern of forbidden) {
        expect(file.source.match(pattern), `${file.path} matched ${pattern}`).toBeNull()
      }
    }

    const plugin = await Bun.file(new URL("src/index.ts", root)).text()
    expect(plugin).toContain("baseUrl: input.serverUrl.toString()")
    expect(plugin).toContain("!isLoopbackHttpUrl(input.serverUrl)")
    expect(plugin).toContain("fetch: createLoopbackOnlyTransport()")
    expect(plugin).not.toContain("projectDirectory: input.directory")
    expect(plugin).not.toMatch(/createV2Client\(\{\s*baseUrl:\s*["']/)
  })

  test("native webview can connect only to local Tauri IPC", async () => {
    const config = JSON.parse(
      await Bun.file(new URL("picker/src-tauri/tauri.conf.json", root)).text(),
    ) as { app: { security: { csp: string } } }
    const csp = config.app.security.csp
    const connectDirective = csp
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("connect-src"))

    expect(connectDirective).toBe("connect-src ipc: http://ipc.localhost")
    expect(csp).not.toMatch(/\bhttps:|\bwss?:/)
  })

  test("public docs state the local boundary and provider caveat", async () => {
    const readme = await Bun.file(new URL("README.md", root)).text()
    const security = await Bun.file(new URL("SECURITY.md", root)).text()

    expect(readme).toContain("The dispatch layer is local-only")
    expect(readme).toMatch(/choose a\s+local OpenCode provider/)
    expect(security).toContain("no independent network egress")
    expect(security).toContain("use a local provider when inference must remain on-device")
  })
})
