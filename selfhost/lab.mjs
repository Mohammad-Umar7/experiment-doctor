#!/usr/bin/env node
/**
 * Sends real Flagsmith SDK traffic from the demo checkout flow to the local rescue lab.
 *
 *   node selfhost/lab.mjs broken [count]   # the shipped bug: trackEvent("Purchase")
 *   node selfhost/lab.mjs fixed  [count]   # after the Doctor's patch: trackEvent("purchase")
 *   node selfhost/lab.mjs probe            # one fresh identity, prints it for verify-events.mjs
 *
 * Uses the official @flagsmith/flagsmith SDK (isomorphic build) with events enabled and the
 * events URL pointed at this instance, exactly like the app would.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createFlagsmithInstance } from "@flagsmith/flagsmith/isomorphic";

const here = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(join(here, "lab.env"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split(/=(.*)/s).slice(0, 2)),
);

const API = env.FLAGSMITH_API_URL ?? "http://localhost:8000";
const mode = process.argv[2] ?? "broken";
const count = Number(process.argv[3] ?? (mode === "probe" ? 1 : 30));
const eventName = mode === "broken" ? "Purchase" : "purchase";

async function visit(identity, converts) {
  const flagsmith = createFlagsmithInstance();
  await flagsmith.init({
    environmentID: env.LAB_ENVIRONMENT_KEY,
    api: `${API}/api/v1/`,
    enableEvents: true,
    eventProcessorConfig: { eventsApiUrl: `${API}/api/` },
  });
  await flagsmith.identify(identity);
  const flag = flagsmith.getExperimentFlag("checkout_button");
  if (converts) flagsmith.trackEvent(eventName);
  await flagsmith.flushEvents();
  return flag?.value ?? null;
}

async function main() {
  const run = Date.now().toString(36);
  const seen = { control: 0, one_click: 0, other: 0 };
  for (let i = 0; i < count; i++) {
    const identity = mode === "probe" ? `doctor-probe-${run}` : `lab-${mode}-${run}-${i}`;
    // Purchases happen for roughly 40% of shoppers, a bit more on one-click.
    const value = await visit(identity, mode === "probe" ? true : Math.random() < 0.4);
    if (value === "control" || value === "one_click") seen[value] += 1;
    else seen.other += 1;
    if (mode === "probe") console.log(identity);
  }
  if (mode !== "probe") {
    console.log(`${count} shoppers (${mode}): control ${seen.control}, one_click ${seen.one_click}, other ${seen.other}; conversion event "${eventName}"`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
