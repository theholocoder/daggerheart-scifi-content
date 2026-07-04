import { defineConfig } from "vite";
import foundryvtt from "vite-plugin-foundryvtt";

import moduleJson from "./src/module.json";

const MODULE_ID = "daggerheart-scifi-content";

export default defineConfig({
  base: `/modules/${MODULE_ID}/`,
  publicDir: "public",
  server: {
    port: 30003,
    open: "/",
    proxy: {
      [`^(?!/modules/${MODULE_ID}/)`]: "http://localhost:30000/",
      "/socket.io": {
        target: "ws://localhost:30000",
        ws: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: false,
    sourcemap: true,
    copyPublicDir: false,
    lib: {
      name: MODULE_ID,
      entry: "src/main.ts",
      formats: ["es"],
      fileName: () => `${MODULE_ID}.js`,
      cssFileName: MODULE_ID,
    },
  },
  esbuild: { keepNames: true },
  plugins: [
    foundryvtt(moduleJson, {
      type: "module",
      buildPacks: false,
      substitutions: {
        url: process.env.PROJECT_URL,
        manifest: process.env.MANIFEST_URL,
        download: process.env.ARCHIVE_URL,
      },
    }),
  ],
});
