const dist = new URL("../dist/", import.meta.url)

await Bun.write(
  new URL("index.html", dist),
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>OpenCode Model Dispatch Picker</title>
  </head>
  <body>
    <main id="app">OpenCode Model Dispatch Picker Skeleton</main>
  </body>
</html>
`,
)
