#!/usr/bin/env node
/**
 * Identity-level pipeline verification for the self-hosted lab.
 *
 *   node selfhost/verify-events.mjs <identity> [--flag checkout_button] [--metric purchase]
 *
 * Reads the experiment event store of this Flagsmith instance (its own PostgreSQL, table
 * experimentation_sdkexperimentationevent) and checks, for ONE identity:
 *   1. a $flag_exposure for the experiment flag was stored,
 *   2. a conversion with the metric's exact event name was stored,
 *   3. the conversion came after the exposure (Flagsmith only counts post-exposure events).
 *
 * Prints PIPELINE_VERIFIED only when all three hold. Aggregate counters are never used as proof.
 * Exit code 0 = verified, 1 = failed, 2 = nothing stored for that identity yet (pending).
 */
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const identity = args[0];
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};
const flag = opt("flag", "checkout_button");
const metric = opt("metric", "purchase");

if (!identity || !/^[A-Za-z0-9_.:@-]{1,200}$/.test(identity)) {
  console.error("usage: verify-events.mjs <identity> [--flag name] [--metric event]");
  process.exit(64);
}

// The identity is validated above and passed as a psql variable, never spliced into SQL text.
const sql = `select event, coalesce(feature_name, ''), to_char(timestamp at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), coalesce(value, '')
  from experimentation_sdkexperimentationevent where identifier = :'identity' order by timestamp, id;`;

const out = execFileSync(
  "docker",
  [
    "compose", "-p", "doctor-lab", "-f", join(here, "docker-compose.yml"),
    "exec", "-T", "postgres",
    "psql", "-U", "postgres", "-d", "flagsmith", "-At", "-F", "\t",
    "-v", `identity=${identity}`, "-f", "-",
  ],
  // psql only substitutes :'identity' in scripts it reads, not in -c, so the query goes in on stdin.
  { encoding: "utf8", input: sql },
);

const rows = out
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const [event, feature, at, value] = line.split("\t");
    return { event, feature, at, value };
  });

if (rows.length === 0) {
  console.log(`PENDING  nothing stored for ${identity} yet (events are buffered; retry in a few seconds)`);
  process.exit(2);
}

const exposure = rows.find((r) => r.event === "$flag_exposure" && r.feature === flag);
const conversion = rows.find((r) => r.event === metric);
const nearMiss = rows.find((r) => r.event !== metric && r.event !== "$flag_exposure" && r.event.toLowerCase() === metric.toLowerCase());

console.log(`events stored for ${identity}:`);
for (const r of rows) console.log(`  ${r.at}  ${r.event}${r.feature ? ` (${r.feature})` : ""}${r.value ? ` = ${r.value}` : ""}`);

const problems = [];
if (!exposure) problems.push(`no $flag_exposure for ${flag}`);
if (!conversion) problems.push(nearMiss ? `conversion stored as "${nearMiss.event}", the metric counts "${metric}"` : `no "${metric}" event stored`);
if (exposure && conversion && conversion.at < exposure.at) problems.push("conversion was stored before the exposure, so it will not be attributed");

if (problems.length) {
  console.log(`\nFAILED   ${problems.join("; ")}`);
  process.exit(1);
}
console.log(`\nPIPELINE_VERIFIED  exposure (${exposure.value || "variant"}) and "${metric}" stored for the same identity, in order`);
