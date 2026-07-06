import { defineConfig } from "vite"
import { svelte } from "@sveltejs/vite-plugin-svelte"

export default defineConfig({
  clearScreen: false,
  plugins: [svelte()],
  build: {
    target: "es2022",
  },
})
