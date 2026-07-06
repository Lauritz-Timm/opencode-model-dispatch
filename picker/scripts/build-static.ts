const proc = Bun.spawn([process.execPath, "run", "vite", "build"], {
  stdout: "inherit",
  stderr: "inherit",
})

process.exit(await proc.exited)
