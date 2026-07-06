declare module "*.svelte" {
  import type { ComponentType } from "svelte"

  const component: ComponentType
  export default component
}

interface ImportMetaEnv {
  readonly DEV: boolean
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
