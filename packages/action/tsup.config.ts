import { fileURLToPath } from "node:url";
import { defineConfig } from "tsup";

// The action runs from a single committed file, so the Doctor's engine is bundled in from source.
export default defineConfig({
  entry: { main: "src/main.ts" },
  format: ["esm"],
  platform: "node",
  target: "node20",
  outDir: "dist",
  clean: true,
  splitting: false,
  noExternal: ["@experiment-doctor/core"],
  esbuildOptions(options) {
    options.alias = { "@experiment-doctor/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)) };
  },
});
