import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { homedir } from "node:os"

export interface ShadowCachePathOptions {
  home?: string
  localAppData?: string
  xdgCacheHome?: string
}

export interface TaskMetadata {
  sessionID?: string
  childSessionID?: string
  session?: { id?: string }
}

export interface SessionRecord {
  id: string
  time?: { archived?: unknown }
}

export interface ShadowAgentCacheOptions {
  cachePath?: string
  staleOrphanMs?: number
  now?: () => number
  removeShadow?: (shadowKey: string) => Promise<void>
  getSession?: (sessionID: string) => Promise<SessionRecord | undefined>
}

interface CachedShadow {
  createdAt: number
  childSessionID?: string
}

interface CacheFile {
  version: 1
  calls: Record<string, string>
  shadows: Record<string, CachedShadow>
}

const DEFAULT_STALE_ORPHAN_MS = 24 * 60 * 60 * 1000

export function defaultShadowCachePath(options: ShadowCachePathOptions = {}): string {
  const home = options.home ?? homedir()
  const localAppData = options.localAppData ?? process.env.LOCALAPPDATA
  const xdgCacheHome = options.xdgCacheHome ?? process.env.XDG_CACHE_HOME
  const cacheRoot = localAppData ?? xdgCacheHome ?? join(home, ".cache")

  return join(cacheRoot, "opencode", "plugins", "opencode-model-dispatch", "shadow-cache.json")
}

export class ShadowAgentCache {
  private readonly cachePath: string
  private readonly staleOrphanMs: number
  private readonly now: () => number
  private readonly removeShadow: (shadowKey: string) => Promise<void>
  private readonly getSession: (sessionID: string) => Promise<SessionRecord | undefined>

  constructor(options: ShadowAgentCacheOptions = {}) {
    this.cachePath = options.cachePath ?? defaultShadowCachePath()
    this.staleOrphanMs = options.staleOrphanMs ?? DEFAULT_STALE_ORPHAN_MS
    this.now = options.now ?? (() => Date.now())
    this.removeShadow = options.removeShadow ?? (async () => {})
    this.getSession = options.getSession ?? (async () => undefined)
  }

  async recordBeforeTask(callID: string, shadowKey: string, createdAt = this.now()): Promise<void> {
    const cache = await this.readCache()
    cache.calls[callID] = shadowKey
    cache.shadows[shadowKey] = cache.shadows[shadowKey] ?? { createdAt }
    await this.writeCache(cache)
  }

  async recordAfterTask(callID: string, metadata: TaskMetadata): Promise<void> {
    const childSessionID = metadata.childSessionID ?? metadata.sessionID ?? metadata.session?.id
    if (!childSessionID) return

    const cache = await this.readCache()
    const shadowKey = cache.calls[callID]
    if (!shadowKey) return

    const shadow = cache.shadows[shadowKey]
    if (!shadow) return

    shadow.childSessionID = childSessionID
    await this.writeCache(cache)
  }

  async getShadowForCall(callID: string): Promise<string | undefined> {
    const cache = await this.readCache()
    return cache.calls[callID]
  }

  async getChildSessionForShadow(shadowKey: string): Promise<string | undefined> {
    const cache = await this.readCache()
    return cache.shadows[shadowKey]?.childSessionID
  }

  async dispose(): Promise<void> {
    const cache = await this.readCache()
    let changed = false

    for (const [shadowKey, shadow] of Object.entries(cache.shadows)) {
      if (shadow.childSessionID) continue
      await this.removeCachedShadow(cache, shadowKey)
      changed = true
    }

    if (changed) await this.writeCache(cache)
  }

  async handleSessionUpdated(session: SessionRecord): Promise<void> {
    if (!isArchived(session)) return

    const cache = await this.readCache()
    let changed = false

    for (const [shadowKey, shadow] of Object.entries(cache.shadows)) {
      if (shadow.childSessionID !== session.id) continue
      await this.removeCachedShadow(cache, shadowKey)
      changed = true
    }

    if (changed) await this.writeCache(cache)
  }

  async collectStartupGarbage(): Promise<void> {
    const cache = await this.readCache()
    let changed = false
    const now = this.now()

    for (const [shadowKey, shadow] of Object.entries(cache.shadows)) {
      if (!shadow.childSessionID) {
        if (now - shadow.createdAt >= this.staleOrphanMs) {
          await this.removeCachedShadow(cache, shadowKey)
          changed = true
        }
        continue
      }

      const session = await this.getSession(shadow.childSessionID)
      if (!session || isArchived(session)) {
        await this.removeCachedShadow(cache, shadowKey)
        changed = true
      }
    }

    if (changed) await this.writeCache(cache)
  }

  private async removeCachedShadow(cache: CacheFile, shadowKey: string): Promise<void> {
    await this.removeShadow(shadowKey)
    delete cache.shadows[shadowKey]
    for (const [callID, mappedShadowKey] of Object.entries(cache.calls)) {
      if (mappedShadowKey === shadowKey) delete cache.calls[callID]
    }
  }

  private async readCache(): Promise<CacheFile> {
    let raw: string
    try {
      raw = await readFile(this.cachePath, "utf8")
    } catch (error) {
      if (isNotFound(error)) return emptyCache()
      throw error
    }

    return decodeCache(JSON.parse(raw))
  }

  private async writeCache(cache: CacheFile): Promise<void> {
    await mkdir(dirname(this.cachePath), { recursive: true })
    await writeFile(this.cachePath, `${JSON.stringify(cache, null, 2)}\n`, "utf8")
  }
}

function emptyCache(): CacheFile {
  return { version: 1, calls: {}, shadows: {} }
}

function decodeCache(value: unknown): CacheFile {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.calls) || !isRecord(value.shadows)) return emptyCache()

  const cache = emptyCache()
  for (const [callID, shadowKey] of Object.entries(value.calls)) {
    if (typeof shadowKey === "string") cache.calls[callID] = shadowKey
  }

  for (const [shadowKey, shadow] of Object.entries(value.shadows)) {
    if (!isRecord(shadow) || typeof shadow.createdAt !== "number") continue
    cache.shadows[shadowKey] = { createdAt: shadow.createdAt }
    if (typeof shadow.childSessionID === "string") cache.shadows[shadowKey].childSessionID = shadow.childSessionID
  }

  return cache
}

function isArchived(session: SessionRecord): boolean {
  return session.time?.archived !== undefined && session.time.archived !== null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isNotFound(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT"
}
