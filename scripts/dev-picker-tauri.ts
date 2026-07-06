import { existsSync } from "node:fs"

const pathSeparator = process.platform === "win32" ? ";" : ":"
const cargoBin = `${Bun.env.USERPROFILE ?? Bun.env.HOME}/.cargo/bin`
if (existsSync(cargoBin)) {
  const path = `${cargoBin}${pathSeparator}${Bun.env.PATH ?? Bun.env.Path ?? ""}`
  Bun.env.PATH = path
  Bun.env.Path = path
}

const proc = Bun.spawn([process.execPath, "run", "--cwd", "picker", "tauri", "dev"], {
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
  env: Bun.env,
})

process.exit(await proc.exited)
