import { mount } from "svelte";
import "bootstrap-icons/font/bootstrap-icons.css";
import "./app.scss";
import App from "./App.svelte";

const app = mount(App, {
  target: document.getElementById("app")!,
});

export default app;
