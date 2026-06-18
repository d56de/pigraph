import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

const SERVER = "http://localhost:5641";
const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf-8"),
);

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  plugins: [svelte()],
  server: {
    proxy: {
      "/events": { target: SERVER, changeOrigin: true },
      "/api": { target: SERVER, changeOrigin: true },
    },
  },
});
