/**
 * The Doctor's measured runs on the exact Human vs Doctor case code, used as the time to beat.
 *
 * Each value comes from a headless Claude Code run (claude -p, Claude Sonnet 5.5) with the
 * flagsmith-experiment-doctor skill and CLI, on a folder holding that case's checkout.js and the
 * Flagsmith config as evidence.json, with the prompt and raw numbers in bench/BENCHMARK.md.
 * ms is wall-clock from the first request to the final answer; tokens counts everything the model
 * processed (input, cache writes, cache reads, output). Regenerate from the benchmark, never edit by hand.
 */
export type DoctorRun = { ms: number; time: string; turns: number; costUsd: number; tokens: number; model: string };

export const DOCTOR_MEASURED_ON = "2026-11-28";

export const DOCTOR_RUNS: Record<string, DoctorRun> = {
  "001": {
    "ms": 37489,
    "time": "00:37.48",
    "turns": 10,
    "costUsd": 0.199,
    "tokens": 478510,
    "model": "Claude Sonnet 5.5"
  },
  "002": {
    "ms": 25298,
    "time": "00:25.29",
    "turns": 6,
    "costUsd": 0.174,
    "tokens": 350011,
    "model": "Claude Sonnet 5.5"
  },
  "003": {
    "ms": 31772,
    "time": "00:31.77",
    "turns": 10,
    "costUsd": 0.213,
    "tokens": 484019,
    "model": "Claude Sonnet 5.5"
  },
  "004": {
    "ms": 25150,
    "time": "00:25.15",
    "turns": 5,
    "costUsd": 0.162,
    "tokens": 289758,
    "model": "Claude Sonnet 5.5"
  },
  "005": {
    "ms": 46547,
    "time": "00:46.54",
    "turns": 16,
    "costUsd": 0.262,
    "tokens": 692266,
    "model": "Claude Sonnet 5.5"
  },
  "006": {
    "ms": 50241,
    "time": "00:50.24",
    "turns": 16,
    "costUsd": 0.278,
    "tokens": 677010,
    "model": "Claude Sonnet 5.5"
  }
};

const FALLBACK: DoctorRun = { ms: Number.POSITIVE_INFINITY, time: "not measured", turns: 0, costUsd: 0, tokens: 0, model: "Claude Sonnet 5.5" };

export function doctorRecordFor(caseId: string): DoctorRun {
  return DOCTOR_RUNS[caseId] ?? FALLBACK;
}
