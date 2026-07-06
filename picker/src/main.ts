import App from "./App.svelte"
import { mount } from "svelte"

const app = document.querySelector<HTMLDivElement>("#app")

if (app) {
  mount(App, { target: app })
}
