import path from "node:path";
import type { NextConfig } from "next";

// The web app imports the Doctor's engine from packages/core, so Turbopack and output
// tracing must treat the monorepo root as the project root.
const monorepoRoot = path.resolve(__dirname, "../..");

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  outputFileTracingRoot: monorepoRoot,
  // Short install URL for the CLI: npx -y --package=https://<site>/doctor.tgz experiment-doctor check
  async redirects() {
    return [
      {
        source: "/doctor.tgz",
        destination: "https://github.com/Mohammad-Umar7/experiment-doctor/releases/download/v0.1.0/experiment-doctor-0.1.0.tgz",
        permanent: false,
      },
    ];
  },
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
