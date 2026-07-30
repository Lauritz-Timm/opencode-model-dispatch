import { describe, expect, test } from "bun:test"
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { stageLifecycleNeutralPackage } from "../scripts/local-npm-pack"

describe("local npm registry dependency packing", () => {
  test("packs installed dependency contents without running package lifecycle scripts", async () => {
    const work = await mkdtemp(join(tmpdir(), "model-dispatch-registry-pack-"))
    const packageRoot = join(work, "source")
    const stageRoot = join(work, "stage")
    const packRoot = join(work, "pack")
    const npmCache = join(work, "npm-cache")
    const manifest = {
      name: "lifecycle-fixture",
      version: "1.0.0",
      description: "fixture metadata must survive local repacking",
      scripts: {
        prepack: 'node -e "process.exit(41)"',
        prepare: 'node -e "process.exit(42)"',
        postpack: 'node -e "process.exit(43)"',
        test: 'node -e "process.exit(44)"',
      },
      files: ["index.js"],
      license: "MIT",
    }

    try {
      await Promise.all([
        mkdir(packageRoot, { recursive: true }),
        mkdir(stageRoot, { recursive: true }),
        mkdir(packRoot, { recursive: true }),
      ])
      await Promise.all([
        writeFile(
          join(packageRoot, "package.json"),
          `${JSON.stringify(manifest, null, 2)}\n`,
          "utf8",
        ),
        writeFile(
          join(packageRoot, "index.js"),
          "export const installed = true\n",
          "utf8",
        ),
      ])

      const stagedPackageRoot = await stageLifecycleNeutralPackage(
        packageRoot,
        stageRoot,
        manifest,
      )
      const stagedManifest = JSON.parse(
        await readFile(join(stagedPackageRoot, "package.json"), "utf8"),
      ) as Record<string, unknown>
      expect(stagedManifest).toMatchObject({
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
        files: manifest.files,
        license: manifest.license,
      })
      expect(stagedManifest.scripts).toEqual({
        test: manifest.scripts.test,
      })
      expect(
        JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")),
      ).toEqual(manifest)

      const child = Bun.spawn(
        [
          "npm",
          "pack",
          "--silent",
          "--pack-destination",
          packRoot,
          stagedPackageRoot,
        ],
        {
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
      expect(`${stderr}${stdout}`).not.toContain("process.exit(4")
      expect(code).toBe(0)

      const tarballs = (await readdir(packRoot)).filter((path) =>
        path.endsWith(".tgz")
      )
      expect(tarballs).toHaveLength(1)
      const entries = await new Bun.Archive(
        await readFile(join(packRoot, tarballs[0]!)),
      ).files()
      const packedManifestFile = entries.get("package/package.json")
      expect(packedManifestFile).toBeDefined()
      const packedManifest = JSON.parse(
        await packedManifestFile!.text(),
      ) as Record<string, unknown>
      expect(packedManifest).toMatchObject({
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
        files: manifest.files,
        license: manifest.license,
      })
      expect(packedManifest.scripts).toEqual({
        test: manifest.scripts.test,
      })
      expect(await entries.get("package/index.js")?.text()).toBe(
        "export const installed = true\n",
      )
    } finally {
      await rm(work, { recursive: true, force: true })
    }
  })
})
