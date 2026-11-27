/**
 * Flagsmith Experimentation results, normalised for the Rescue Center.
 *
 * Shape of GET /api/v1/environments/{env}/experiments/{id}/results/ (from the Flagsmith source,
 * experimentation/dataclasses.py and stats.py):
 *   { as_of, is_final, payload: { srm_p_value, metrics: [{ metric_id,
 *       variants: { [key]: { n, sum, sum_squares } },
 *       inference: { [key]: { lift, ci_low, ci_high, chance_to_win } | null } }] } }
 */

export type RawVariantStats = { n: number; sum: number; sum_squares?: number };
export type RawInference = { lift: number; ci_low: number; ci_high: number; chance_to_win: number } | null;
export type RawResultsBody = {
  as_of?: string | null;
  is_final?: boolean;
  payload?: {
    srm_p_value?: number | null;
    metrics?: Array<{
      metric_id: number;
      variants: Record<string, RawVariantStats>;
      inference: Record<string, RawInference>;
    }>;
  } | null;
};
/** The endpoint wraps the body as `{ results: {...} }`; older snapshots may be unwrapped. */
export type RawResults = (RawResultsBody & { results?: RawResultsBody | null }) | null;

export type VariantResult = { key: string; exposed: number; converted: number; rate: number | null };

export type ExperimentResults = {
  source: "live" | "snapshot" | "none";
  asOf: string | null;
  isFinal: boolean;
  srmPValue: number | null;
  variants: VariantResult[];
  /** Inference for the treatment vs control, as Flagsmith computed it. */
  treatment: { key: string; chanceToWin: number; lift: number; ciLow: number; ciHigh: number } | null;
};

export const EMPTY_RESULTS: ExperimentResults = {
  source: "none",
  asOf: null,
  isFinal: false,
  srmPValue: null,
  variants: [],
  treatment: null,
};

export function normaliseResults(wrapped: RawResults, source: ExperimentResults["source"]): ExperimentResults {
  const raw: RawResultsBody | null = wrapped?.results ?? wrapped;
  const metric = raw?.payload?.metrics?.[0];
  if (!raw || !metric) return { ...EMPTY_RESULTS, source, asOf: raw?.as_of ?? null };

  const variants = Object.entries(metric.variants).map(([key, v]) => ({
    key,
    exposed: v.n,
    converted: v.sum,
    rate: v.n > 0 ? v.sum / v.n : null,
  }));
  const inferenceEntry = Object.entries(metric.inference ?? {}).find(([, inf]) => inf !== null);
  const treatment = inferenceEntry
    ? {
        key: inferenceEntry[0],
        chanceToWin: inferenceEntry[1]!.chance_to_win,
        lift: inferenceEntry[1]!.lift,
        ciLow: inferenceEntry[1]!.ci_low,
        ciHigh: inferenceEntry[1]!.ci_high,
      }
    : null;

  return {
    source,
    asOf: raw.as_of ?? null,
    isFinal: Boolean(raw.is_final),
    srmPValue: raw.payload?.srm_p_value ?? null,
    variants,
    treatment,
  };
}
