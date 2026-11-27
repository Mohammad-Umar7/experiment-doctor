#!/usr/bin/env node
/**
 * Saves a dated snapshot of the Human vs Doctor experiment results from Flagsmith, using the
 * official Flagsmith CLI and its stored login (no API key in this repo).
 *
 *   node apps/web/scripts/flagsmith-snapshot.mjs <environment key> <experiment id> [--refresh]
 *
 * --refresh asks Flagsmith to recompute first (allowed once every 5 minutes).
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const [env, id, ...flags] = process.argv.slice(2);
if (!env || !id) {
  console.error("usage: flagsmith-snapshot.mjs <environment key> <experiment id> [--refresh]");
  process.exit(1);
}

const cli = (args) =>
  execFileSync("npx", ["-y", "@flagsmith/cli@2.0.0", ...args], {
    encoding: "utf8",
    shell: process.platform === "win32",
  });

const base = `api/v1/environments/${env}/experiments/${id}`;
if (flags.includes("--refresh")) {
  try {
    cli(["api", `${base}/results/refresh/`, "-X", "POST"]);
  } catch {
    console.warn("refresh skipped (rate limited or not running)");
  }
}

const experiment = JSON.parse(cli(["api", `${base}/`]));
const results = JSON.parse(cli(["api", `${base}/results/`]));

const out = {
  savedAt: new Date().toISOString(),
  experiment: {
    id: experiment.id,
    name: experiment.name,
    status: experiment.status,
    hypothesis: experiment.hypothesis,
    started_at: experiment.started_at,
  },
  results,
};

const target = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "data", "flagsmith-results.json");
writeFileSync(target, JSON.stringify(out, null, 2) + "\n");
console.log(`saved ${target} (status ${experiment.status}, results ${results?.payload ? "present" : "not ready"})`);
