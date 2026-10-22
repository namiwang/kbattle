import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Two pages: the app, and the disposable v0.6 thinker spike (may go in P4).
export default defineConfig({
  build: {
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        "spike-thinker": fileURLToPath(new URL("./spike-thinker.html", import.meta.url)),
      },
    },
  },
});
