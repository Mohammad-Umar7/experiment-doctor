import "server-only";
import snapshot from "@/data/flagsmith-results.json";
import { EMPTY_RESULTS, normaliseResults, type ExperimentResults, type RawResults } from "@/lib/experiment-results";

/**
 * Reads the Human vs Doctor experiment results from Flagsmith.
 * Live when FLAGSMITH_API_KEY, FLAGSMITH_ENVIRONMENT_KEY and FLAGSMITH_EXPERIMENT_ID are set;
 * otherwise the dated snapshot written by scripts/flagsmith-snapshot.mjs with the Flagsmith CLI.
 */
let cache: { at: number; value: ExperimentResults } | null = null;
const TTL_MS = 60_000;

export async function getExperimentResults(): Promise<ExperimentResults> {
  const key = process.env.FLAGSMITH_API_KEY;
  const env = process.env.FLAGSMITH_ENVIRONMENT_KEY;
  const id = process.env.FLAGSMITH_EXPERIMENT_ID;
  const api = (process.env.FLAGSMITH_API_URL ?? "https://api.flagsmith.com").replace(/\/$/, "");

  if (!key || !env || !id) {
    const raw = (snapshot as { results?: RawResults }).results ?? null;
    return raw ? normaliseResults(raw, "snapshot") : EMPTY_RESULTS;
  }

  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  try {
    const res = await fetch(`${api}/api/v1/environments/${env}/experiments/${id}/results/`, {
      headers: { Authorization: `Api-Key ${key}`, Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(String(res.status));
    const value = normaliseResults((await res.json()) as RawResults, "live");
    cache = { at: Date.now(), value };
    return value;
  } catch {
    return cache?.value ?? EMPTY_RESULTS;
  }
}
