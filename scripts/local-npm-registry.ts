import { access, mkdir, readFile, readdir, rm } from "node:fs/promises"
import { constants } from "node:fs"
import { createHash } from "node:crypto"
import { createServer } from "node:net"
import { join } from "node:path"

import { stageLifecycleNeutralPackage } from "./local-npm-pack"

export interface LocalRegistryDependency {
  name: string
  optional?: boolean
}

export interface LocalRegistryTarball {
  packageRoot: string
  tarballPath: string
}

export interface LocalNpmRegistry {
  server: Bun.Server<undefined>
  baseURL: string
  requests: string[]
  assertInstalled(packageName?: string, minimumTarballHits?: number): void
}

interface LocalRegistryPackage {
  name: string
  version: string
  manifest: Record<string, unknown>
  tarball: Buffer
  integrity: string
  shasum: string
  tarballPath: string
}

export async function startLocalNpmRegistry(options: {
  root: string
  work: string
  port?: number
  initialTarballs: LocalRegistryTarball[]
  additionalDependencies?: LocalRegistryDependency[]
}): Promise<LocalNpmRegistry> {
  assert(
    options.initialTarballs.length > 0,
    "Local registry requires at least one exact package tarball",
  )

  const packages = new Map<string, LocalRegistryPackage>()
  for (const initial of options.initialTarballs) {
    await access(initial.tarballPath, constants.R_OK)
    const manifest = JSON.parse(
      await readFile(join(initial.packageRoot, "package.json"), "utf8"),
    ) as Record<string, unknown>
    const entry = registryPackage(
      manifest,
      await readFile(initial.tarballPath),
    )
    assert(
      !packages.has(entry.name),
      `Local registry received duplicate initial package ${entry.name}`,
    )
    packages.set(entry.name, entry)
  }

  await collectLocalDependencyGraph(
    packages,
    [
      ...Array.from(packages.values()).flatMap((entry) =>
        dependencyEntries(entry.manifest)
      ),
      ...(options.additionalDependencies ?? []),
    ],
    options.root,
    options.work,
  )

  const requests: string[] = []
  const metadataHits = new Map<string, number>()
  const tarballHits = new Map<string, number>()
  let baseURL = ""
  const tarballs = new Map(
    Array.from(packages.values(), (entry) => [entry.tarballPath, entry]),
  )
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: options.port ?? await reserveLoopbackPort(),
    fetch(request) {
      const url = new URL(request.url)
      requests.push(`${request.method} ${url.pathname}`)
      const tarballEntry = tarballs.get(url.pathname)
      if (
        tarballEntry &&
        (request.method === "GET" || request.method === "HEAD")
      ) {
        tarballHits.set(
          tarballEntry.name,
          (tarballHits.get(tarballEntry.name) ?? 0) + 1,
        )
        return new Response(
          request.method === "HEAD" ? null : tarballEntry.tarball,
          {
            headers: {
              "Content-Length": String(tarballEntry.tarball.byteLength),
              "Content-Type": "application/octet-stream",
            },
          },
        )
      }

      const metadataRequest = registryMetadataRequest(url.pathname, packages)
      if (request.method === "GET" && metadataRequest) {
        const { entry, versionRequest } = metadataRequest
        metadataHits.set(
          entry.name,
          (metadataHits.get(entry.name) ?? 0) + 1,
        )
        const release = {
          ...entry.manifest,
          dist: {
            integrity: entry.integrity,
            shasum: entry.shasum,
            tarball: `${baseURL}${entry.tarballPath}`,
          },
        }
        return Response.json(
          versionRequest
            ? release
            : {
                name: entry.name,
                "dist-tags": { latest: entry.version },
                versions: { [entry.version]: release },
              },
          {
            headers: {
              "Cache-Control": "no-store",
            },
          },
        )
      }

      return Response.json(
        { error: `Local integration registry has no ${url.pathname}` },
        { status: 404 },
      )
    },
  })
  baseURL = `http://127.0.0.1:${server.port}`
  const primaryName = packages.values().next().value?.name

  return {
    server,
    baseURL,
    requests,
    assertInstalled(packageName = primaryName, minimumTarballHits = 1) {
      assert(packageName, "Local registry has no primary package")
      assert(
        (metadataHits.get(packageName) ?? 0) > 0 &&
          (tarballHits.get(packageName) ?? 0) >= minimumTarballHits,
        `Local registry did not serve ${packageName} as expected: ${requests.join(", ")}`,
      )
    },
  }
}

async function reserveLoopbackPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => resolve())
  })
  const address = server.address()
  assert(
    address && typeof address === "object",
    "Could not reserve a loopback registry port",
  )
  const port = address.port
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
  return port
}

function registryPackage(
  manifest: Record<string, unknown>,
  tarball: Buffer,
): LocalRegistryPackage {
  const name = readString(manifest, "name")
  const version = readString(manifest, "version")
  assert(name && version, "Local registry package metadata omitted name or version")
  return {
    name,
    version,
    manifest,
    tarball,
    shasum: createHash("sha1").update(tarball).digest("hex"),
    integrity: `sha512-${createHash("sha512").update(tarball).digest("base64")}`,
    tarballPath: `/tarballs/${encodeURIComponent(name)}-${encodeURIComponent(version)}.tgz`,
  }
}

async function collectLocalDependencyGraph(
  packages: Map<string, LocalRegistryPackage>,
  initialDependencies: LocalRegistryDependency[],
  root: string,
  work: string,
): Promise<void> {
  const queue = [...initialDependencies]
  const packRoot = join(work, "local-registry-pack")
  const stageRoot = join(work, "local-registry-stage")
  const npmCache = join(work, "local-registry-npm-cache")
  await Promise.all([
    mkdir(packRoot, { recursive: true }),
    mkdir(stageRoot, { recursive: true }),
  ])

  while (queue.length) {
    const dependency = queue.shift()!
    const { name } = dependency
    if (packages.has(name)) continue
    const packageRoot = join(root, "node_modules", ...name.split("/"))
    let manifest: Record<string, unknown>
    try {
      manifest = JSON.parse(
        await readFile(join(packageRoot, "package.json"), "utf8"),
      ) as Record<string, unknown>
    } catch (error) {
      if (
        dependency.optional &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        continue
      }
      throw error
    }
    assert(
      readString(manifest, "name") === name,
      `Local dependency ${name} has unexpected installed metadata`,
    )

    const stagedPackageRoot = await stageLifecycleNeutralPackage(
      packageRoot,
      stageRoot,
      manifest,
    )
    const tarball = await (async () => {
      try {
        const existingTarballs = new Set(await readdir(packRoot))
        const child = Bun.spawn(
          [
            "npm",
            "pack",
            "--silent",
            "--ignore-scripts",
            "--pack-destination",
            packRoot,
            stagedPackageRoot,
          ],
          {
            cwd: root,
            env: {
              ...process.env,
              npm_config_cache: npmCache,
            },
            stdout: "pipe",
            stderr: "pipe",
          },
        )
        const [stdout, stderr, code] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ])
        if (code !== 0) {
          throw new Error(
            `Could not pack locked local registry dependency ${name}: ${stderr || stdout}`,
          )
        }
        const packedTarballs = (await readdir(packRoot)).filter(
          (filename) =>
            filename.endsWith(".tgz") && !existingTarballs.has(filename),
        )
        assert(
          packedTarballs.length === 1,
          `npm pack produced ${packedTarballs.length} new tarballs for ${name}: ${stdout}`,
        )
        return readFile(join(packRoot, packedTarballs[0]!))
      } finally {
        await rm(stagedPackageRoot, { recursive: true, force: true })
      }
    })()
    packages.set(
      name,
      registryPackage(manifest, tarball),
    )
    queue.push(...dependencyEntries(manifest))
  }
}

function dependencyEntries(
  manifest: Record<string, unknown>,
): LocalRegistryDependency[] {
  const dependencies = new Map<string, boolean>()
  for (const name of Object.keys(asRecord(manifest.dependencies))) {
    dependencies.set(name, false)
  }
  for (const name of Object.keys(asRecord(manifest.optionalDependencies))) {
    if (!dependencies.has(name)) dependencies.set(name, true)
  }
  const peerDependencies = asRecord(manifest.peerDependencies)
  const peerMetadata = asRecord(manifest.peerDependenciesMeta)
  for (const name of Object.keys(peerDependencies)) {
    dependencies.set(
      name,
      asRecord(peerMetadata[name]).optional === true &&
        dependencies.get(name) !== false,
    )
  }
  return Array.from(dependencies, ([name, optional]) => ({ name, optional }))
}

function registryMetadataRequest(
  pathname: string,
  packages: Map<string, LocalRegistryPackage>,
): { entry: LocalRegistryPackage; versionRequest: boolean } | undefined {
  const decoded = decodeURIComponent(pathname.slice(1))
  const exact = packages.get(decoded)
  if (exact) return { entry: exact, versionRequest: false }
  for (const entry of packages.values()) {
    if (decoded === `${entry.name}/${entry.version}`) {
      return { entry, versionRequest: true }
    }
  }
  return undefined
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? value as Record<string, unknown>
    : {}
}

function readString(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  const candidate = value[key]
  return typeof candidate === "string" ? candidate : undefined
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
