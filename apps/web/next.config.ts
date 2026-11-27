import path from "node:path";
import type { NextConfig } from "next";

// The web app imports the Doctor's engine from packages/core, so Turbopack and output
// tracing must treat the monorepo root as the project root.
const monorepoRoot = path.resolve(__dirname, "../..");

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  outputFileTracingRoot: monorepoRoot,
  turbopack: {
    root: monorepoRoot,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
