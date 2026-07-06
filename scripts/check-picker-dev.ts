import { existsSync } from "node:fs"

type Check = {
  name: string
  commandText: string
  command: string[]
  required: boolean
  hint: string
}

const pathSeparator = process.platform === "win32" ? ";" : ":"
const cargoBin = `${Bun.env.USERPROFILE ?? Bun.env.HOME}/.cargo/bin`
if (existsSync(cargoBin)) {
  const path = `${cargoBin}${pathSeparator}${Bun.env.PATH ?? Bun.env.Path ?? ""}`
  Bun.env.PATH = path
  Bun.env.Path = path
}

const checks: Check[] = [
  {
    name: "Rust Cargo",
    commandText: "cargo --version",
    command: ["cargo", "--version"],
    required: true,
    hint: "Install Rust from https://rustup.rs, then restart the terminal so cargo is on PATH.",
  },
  {
    name: "Rust compiler",
    commandText: "rustc --version",
    command: ["rustc", "--version"],
    required: true,
    hint: "Install Rust from https://rustup.rs, then restart the terminal so rustc is on PATH.",
  },
  {
    name: "Picker Tauri CLI",
    commandText: "bun run --cwd picker tauri --version",
    command: [process.execPath, "run", "--cwd", "picker", "tauri", "--version"],
    required: true,
    hint: "Run `bun install` in the repo root and `bun install` in picker/.",
  },
  {
    name: "Picker web preview script",
    commandText: "bun run preview:picker",
    command: [process.execPath, "run", "preview:picker", "--help"],
    required: false,
    hint: "Run `bun run preview:picker` for browser preview without native Tauri.",
  },
]

let failed = false

for (const check of checks) {
  let result: ReturnType<typeof Bun.spawnSync>
  try {
    result = Bun.spawnSync(check.command, { stdout: "pipe", stderr: "pipe", env: Bun.env })
  } catch (error) {
    const level = check.required ? "missing" : "warn"
    console.error(`${level}: ${check.name}`)
    console.error(`command: ${check.commandText}`)
    console.error(error instanceof Error ? error.message : String(error))
    console.error(`hint: ${check.hint}`)
    if (check.required) failed = true
    continue
  }
  const output = `${result.stdout.toString()}${result.stderr.toString()}`.trim()
  if (result.exitCode === 0) {
    console.log(`ok: ${check.name}${output ? ` (${output.split(/\r?\n/)[0]})` : ""}`)
    continue
  }

  const level = check.required ? "missing" : "warn"
  console.error(`${level}: ${check.name}`)
  console.error(`command: ${check.commandText}`)
  if (output) console.error(output)
  console.error(`hint: ${check.hint}`)
  if (check.required) failed = true
}

if (failed) {
  console.error("picker native dev is not ready. Web preview still works with `bun run preview:picker`.")
  process.exit(1)
}

console.log("picker native dev prerequisites are ready. Run `bun run dev:picker:tauri`.")
