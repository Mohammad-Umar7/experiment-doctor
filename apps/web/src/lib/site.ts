/** Public facts about the project used across pages. */
export const REPO_URL = "https://github.com/Mohammad-Umar7/experiment-doctor";
export const SITE_NAME = "Experiment Doctor";
export const SITE_TAGLINE = "Your experiment is flatlining. Find out why.";
export const SITE_DESCRIPTION =
  "Diagnose broken Flagsmith experiments, repair them with evidence, and race an AI doctor to fix one in under three minutes.";

/** The challenge time limit, in milliseconds. Repairs verified within this window count as conversions. */
export const CHALLENGE_LIMIT_MS = 180_000;

/** The Flagsmith flag and metric used by the Human vs Doctor experiment. */
export const EXPERIMENT_FLAG = "doctor_hint_style";
export const EXPERIMENT_EVENT = "verified_repair";
export const HINT_VARIANTS = {
  control: "full_report",
  challenger: "one_fix",
} as const;
export type HintVariant = (typeof HINT_VARIANTS)[keyof typeof HINT_VARIANTS];
