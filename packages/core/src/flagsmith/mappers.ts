/**
 * Raw Flagsmith API / CLI JSON -> evidence. Shapes follow the serializers in
 * Flagsmith/flagsmith api/experimentation/serializers.py and the CLI's
 * `feature get --json` view. Everything is defensive: unknown input gives
 * undefined (unknown), never a made-up "ok".
 */
import type {
  EnvironmentEvidence,
  ExperimentEvidence,
  FlagEvidence,
  MetricEvidence,
  MetricResultEvidence,
  ResultsEvidence,
  VariantEvidence,
  WarehouseEvidence,
} from '../types';
import { maskKey } from '../util/redact';
import { isCloudUrl } from '../util/urls';

type Json = Record<string, unknown>;

const obj = (v: unknown): Json | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** DRF lists come either bare or paginated ({count, results}). */
export function listOf(raw: unknown): Json[] {
  if (Array.isArray(raw)) return raw.map(obj).filter((x): x is Json => !!x);
  const o = obj(raw);
  if (o && Array.isArray(o.results)) return (o.results as unknown[]).map(obj).filter((x): x is Json => !!x);
  return [];
}

export function mapEnvironment(raw: unknown, apiUrl?: string, key?: string): EnvironmentEvidence | undefined {
  const o = obj(raw);
  const name = str(o?.name);
  if (!name) return undefined;
  const env: EnvironmentEvidence = { name };
  const hint = maskKey(key ?? str(o?.api_key));
  if (hint) env.keyHint = hint;
  if (apiUrl) {
    env.apiUrl = apiUrl;
    env.selfHosted = !isCloudUrl(apiUrl);
  } else env.selfHosted = false;
  return env;
}

export function mapWarehouses(raw: unknown): WarehouseEvidence[] {
  return listOf(raw).map((w) => {
    const config = obj(w.config);
    const out: WarehouseEvidence = {
      id: num(w.id) ?? 0,
      type: str(w.warehouse_type) ?? 'unknown',
      status: str(w.status) ?? 'unknown',
    };
    if (w.status_detail !== undefined) out.statusDetail = str(w.status_detail) ?? null;
    if (config?.source === 'flagsmith_database') out.flagsmithDatabase = true;
    if ('total_events_received' in w) out.totalEventsReceived = num(w.total_events_received) ?? null;
    if ('last_event_received_at' in w) out.lastEventAt = str(w.last_event_received_at) ?? null;
    return out;
  });
}

const STATUS_RANK: Record<string, number> = { running: 0, paused: 1, created: 2, completed: 3 };

/** Picks the experiment to diagnose: by id, else the most relevant one on the flag. */
export function pickExperiment(raw: unknown, opts: { experimentId?: number; flag?: string }): Json | null {
  const list = listOf(raw);
  if (opts.experimentId !== undefined) return list.find((e) => num(e.id) === opts.experimentId) ?? null;
  const featureName = (e: Json) => str(obj(e.feature)?.name);
  const candidates = opts.flag ? list.filter((e) => featureName(e) === opts.flag) : list.filter((e) => str(e.status) !== 'completed');
  if (!candidates.length) return null;
  return [...candidates].sort(
    (a, b) => (STATUS_RANK[str(a.status) ?? ''] ?? 9) - (STATUS_RANK[str(b.status) ?? ''] ?? 9) || (str(b.created_at) ?? '').localeCompare(str(a.created_at) ?? ''),
  )[0]!;
}

export function mapExperiment(raw: unknown): ExperimentEvidence | undefined {
  const e = obj(raw);
  const id = num(e?.id);
  if (!e || id === undefined) return undefined;
  const feature = obj(e.feature);
  const metricIds = (Array.isArray(e.metrics) ? e.metrics : [])
    .map((m) => (typeof m === 'number' ? m : num(obj(m)?.metric)))
    .filter((x): x is number => x !== undefined);
  const out: ExperimentEvidence = {
    id,
    name: str(e.name) ?? `Experiment ${id}`,
    status: str(e.status) ?? 'unknown',
    metricIds,
    startedAt: str(e.started_at) ?? null,
    endedAt: str(e.ended_at) ?? null,
  };
  const featureId = num(feature?.id) ?? num(e.feature);
  if (featureId !== undefined) out.featureId = featureId;
  const featureName = str(feature?.name);
  if (featureName) out.featureName = featureName;
  if ('rollout_decision' in e) out.rolloutDecision = str(e.rollout_decision) ?? null;
  if ('experiment_rollout' in e) {
    const r = obj(e.experiment_rollout);
    out.rollout = r ? { enabled: r.enabled === true, rolloutPercentage: num(r.rollout_percentage) ?? 0 } : null;
  }
  return out;
}

function optionValue(o: Json): string | number | boolean | null {
  if ('value' in o) return (o.value as string | number | boolean | null) ?? null;
  const type = str(o.type);
  if (type === 'integer' || type === 'int') return num(o.integer_value) ?? null;
  if (type === 'boolean' || type === 'bool') return o.boolean_value === true;
  return str(o.string_value) ?? num(o.integer_value) ?? (typeof o.boolean_value === 'boolean' ? o.boolean_value : null);
}

function mapVariants(list: unknown): VariantEvidence[] {
  return (Array.isArray(list) ? list : [])
    .map(obj)
    .filter((x): x is Json => !!x)
    .map((o) => {
      const v: VariantEvidence = { id: num(o.id) ?? 0, value: optionValue(o), key: str(o.key) || null };
      const weight = num(o.weight) ?? num(o.default_percentage_allocation);
      if (weight !== undefined) v.weight = weight;
      return v;
    });
}

/** From `flagsmith feature get <flag> --json`. */
export function mapFeatureGet(raw: unknown): FlagEvidence | undefined {
  const f = obj(raw);
  const name = str(f?.name);
  if (!f || !name) return undefined;
  const out: FlagEvidence = { name, variants: mapVariants(f.variants ?? f.multivariate_options) };
  const id = num(f.id);
  if (id !== undefined) out.id = id;
  if (str(f.type)) out.type = str(f.type)!;
  if (typeof f.enabled === 'boolean') out.enabled = f.enabled;
  return out;
}

/** From the nested `feature` of an experiment (ExperimentFeatureSerializer). */
export function mapExperimentFeature(raw: unknown): FlagEvidence | undefined {
  return mapFeatureGet(raw);
}

export function mapMetrics(raw: unknown, onlyIds?: number[]): MetricEvidence[] {
  return listOf(raw)
    .map((m) => {
      const def = obj(m.definition);
      const out: MetricEvidence = {
        id: num(m.id) ?? 0,
        name: str(m.name) ?? `metric ${String(m.id)}`,
        event: str(def?.event) ?? '',
        aggregation: str(m.aggregation) ?? 'unknown',
      };
      if (str(m.direction)) out.direction = str(m.direction)!;
      return out;
    })
    .filter((m) => !onlyIds || onlyIds.includes(m.id));
}

/** From GET .../experiments/<id>/results/ -> {"results": null | {...}}. */
export function mapResults(raw: unknown, metrics: MetricEvidence[] = []): ResultsEvidence | null | undefined {
  const o = obj(raw);
  if (!o) return undefined;
  const r = 'results' in o ? obj(o.results) : o;
  if ('results' in o && o.results === null) return null;
  if (!r) return undefined;
  const payload = obj(r.payload);
  if (!payload) return null;
  const out: ResultsEvidence = {
    asOf: str(r.as_of) ?? null,
    isFinal: r.is_final === true,
    lastErrorAt: str(r.last_error_at) ?? null,
    srmPValue: num(payload.srm_p_value) ?? null,
    metrics: [],
  };
  for (const m of Array.isArray(payload.metrics) ? payload.metrics : []) {
    const mo = obj(m);
    if (!mo) continue;
    const metricId = num(mo.metric_id) ?? 0;
    const aggregation = metrics.find((x) => x.id === metricId)?.aggregation;
    const variants = obj(mo.variants) ?? {};
    const inference = obj(mo.inference) ?? {};
    const mr: MetricResultEvidence = { metricId, variants: [] };
    if (aggregation) mr.aggregation = aggregation;
    for (const [key, stats] of Object.entries(variants)) {
      const s = obj(stats);
      const inf = obj(inference[key]);
      const v: MetricResultEvidence['variants'][number] = { variant: key, identities: num(s?.n) ?? 0 };
      if (aggregation === 'occurrence') v.conversions = Math.round(num(s?.sum) ?? 0);
      v.chanceToWin = num(inf?.chance_to_win) ?? null;
      if (inf) {
        v.lift = num(inf.lift) ?? null;
        v.ciLow = num(inf.ci_low) ?? null;
        v.ciHigh = num(inf.ci_high) ?? null;
      }
      mr.variants.push(v);
    }
    out.metrics.push(mr);
  }
  return out;
}
