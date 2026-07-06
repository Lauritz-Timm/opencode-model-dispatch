import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { ShadowAgentCache, defaultShadowCachePath } from "../src/shadow-cache"

const tempDirs: string[] = []

async function tempCachePath() {
  const dir = await mkdtemp(join(tmpdir(), "model-dispatch-shadow-cache-"))
  tempDirs.push(dir)
  return join(dir, "cache", "shadow-cache.json")
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })))
})

describe("shadow agent cache", () => {
  test("stores call ids before task execution and maps child sessions from task metadata after task execution", async () => {
    const cache = new ShadowAgentCache({ cachePath: await tempCachePath() })

    await cache.recordBeforeTask("call-1", "shadow-alpha")
    await cache.recordAfterTask("call-1", { sessionID: "child-1" })

    expect(await cache.getShadowForCall("call-1")).toBe("shadow-alpha")
    expect(await cache.getChildSessionForShadow("shadow-alpha")).toBe("child-1")
  })

  test("dispose removes only orphaned shadows without child session ids", async () => {
    const removed: string[] = []
    const cache = new ShadowAgentCache({ cachePath: await tempCachePath(), removeShadow: async (key) => removed.push(key) })

    await cache.recordBeforeTask("orphan-call", "shadow-orphan")
    await cache.recordBeforeTask("mapped-call", "shadow-mapped")
    await cache.recordAfterTask("mapped-call", { sessionID: "child-1" })

    await cache.dispose()

    expect(removed).toEqual(["shadow-orphan"])
    expect(await cache.getShadowForCall("mapped-call")).toBe("shadow-mapped")
    expect(await cache.getChildSessionForShadow("shadow-mapped")).toBe("child-1")
  })

  test("session archive updates remove mapped shadows", async () => {
    const removed: string[] = []
    const cache = new ShadowAgentCache({ cachePath: await tempCachePath(), removeShadow: async (key) => removed.push(key) })
    await cache.recordBeforeTask("call-1", "shadow-alpha")
    await cache.recordAfterTask("call-1", { sessionID: "child-1" })

    await cache.handleSessionUpdated({ id: "child-1", time: { archived: 123 } })

    expect(removed).toEqual(["shadow-alpha"])
    expect(await cache.getChildSessionForShadow("shadow-alpha")).toBeUndefined()
    expect(await cache.getShadowForCall("call-1")).toBeUndefined()
  })

  test("startup garbage collection removes stale orphans and mapped shadows whose child sessions are archived or missing", async () => {
    const removed: string[] = []
    const cache = new ShadowAgentCache({
      cachePath: await tempCachePath(),
      now: () => 10_000,
      staleOrphanMs: 1_000,
      removeShadow: async (key) => removed.push(key),
      getSession: async (sessionID) => {
        if (sessionID === "active-child") return { id: sessionID, time: {} }
        if (sessionID === "archived-child") return { id: sessionID, time: { archived: 1 } }
        return undefined
      },
    })

    await cache.recordBeforeTask("fresh-orphan-call", "shadow-fresh-orphan")
    await cache.recordBeforeTask("stale-orphan-call", "shadow-stale-orphan", 8_000)
    await cache.recordBeforeTask("active-call", "shadow-active")
    await cache.recordAfterTask("active-call", { sessionID: "active-child" })
    await cache.recordBeforeTask("archived-call", "shadow-archived")
    await cache.recordAfterTask("archived-call", { sessionID: "archived-child" })
    await cache.recordBeforeTask("missing-call", "shadow-missing")
    await cache.recordAfterTask("missing-call", { sessionID: "missing-child" })

    await cache.collectStartupGarbage()

    expect(removed).toEqual(["shadow-stale-orphan", "shadow-archived", "shadow-missing"])
    expect(await cache.getShadowForCall("fresh-orphan-call")).toBe("shadow-fresh-orphan")
    expect(await cache.getChildSessionForShadow("shadow-active")).toBe("active-child")
    expect(await cache.getChildSessionForShadow("shadow-archived")).toBeUndefined()
    expect(await cache.getChildSessionForShadow("shadow-missing")).toBeUndefined()
  })

  test("default cache path is under the user OpenCode plugin cache area", () => {
    const path = defaultShadowCachePath({ home: "C:/Users/Ada", localAppData: "C:/Users/Ada/AppData/Local" })

    expect(path).toContain("opencode")
    expect(path).toContain("plugins")
    expect(path).toContain("opencode-model-dispatch")
    expect(path).not.toContain("Documents/GitHub")
  })
})
