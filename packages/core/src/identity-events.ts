import { EXPOSURE_EVENT_NAME } from './constants';

/**
 * Identity-level pipeline evidence: the events one identity actually has in
 * the experiment event store (for example the Flagsmith database warehouse,
 * table experimentation_sdkexperimentationevent). Aggregate counters are
 * never used here.
 */
export interface StoredEvent {
  event: string;
  featureName: string;
  /** ISO timestamp, UTC (the event's own timestamp). */
  at: string;
  value: string;
  /** Raw metadata JSON; SDK exposures carry {"experiment_id": n}. */
  metadata?: string;
}

export interface IdentityEventsVerdict {
  status: 'IDENTITY_VERIFIED' | 'FAILED' | 'PENDING';
  identity: string;
  problems: string[];
  exposure?: StoredEvent;
  conversion?: StoredEvent;
  /** Events ignored because they are older than `since`. */
  stale: number;
  message: string;
}

export interface IdentityEventsOptions {
  flag: string;
  event: string;
  /** Only exposures tagged with this experiment id count. */
  experimentId?: number;
  /** Only events at or after this ISO time count (the repair, or the start of verify). */
  since?: string;
}

/** Parses psql -At -F '\t' output: event, feature_name, timestamp, value, metadata. */
export function parseStoredEvents(tsv: string): StoredEvent[] {
  return tsv
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .map((line) => {
      const [event = '', featureName = '', at = '', value = '', metadata] = line.split('\t');
      const row: StoredEvent = { event, featureName, at, value };
      if (metadata) row.metadata = metadata;
      return row;
    });
}

export function experimentIdOf(row: StoredEvent): number | undefined {
  if (!row.metadata) return undefined;
  try {
    const id = (JSON.parse(row.metadata) as { experiment_id?: unknown }).experiment_id;
    return typeof id === 'number' ? id : typeof id === 'string' && /^\d+$/.test(id) ? Number(id) : undefined;
  } catch {
    return undefined;
  }
}

const ms = (iso: string) => Date.parse(iso);

/**
 * IDENTITY_VERIFIED only when, among events at or after `since`, this identity
 * has an exposure for the flag (tagged with the experiment, when given) and a
 * conversion with the metric's exact name after it. FAILED only for evidence
 * of a wrong pipeline (a near-miss event name, or the conversion only before
 * the exposure). Anything missing is PENDING: it may simply not have happened yet.
 */
export function evaluateIdentityEvents(identity: string, rows: StoredEvent[], opts: IdentityEventsOptions): IdentityEventsVerdict {
  const fresh = opts.since ? rows.filter((r) => ms(r.at) >= ms(opts.since!)) : rows;
  const stale = rows.length - fresh.length;
  const base = { identity, stale };
  if (fresh.length === 0) {
    return {
      ...base,
      status: 'PENDING',
      problems: [],
      message: stale
        ? `${stale} event(s) stored for ${identity} are older than ${opts.since}, so they do not count. Waiting for new ones.`
        : `Nothing stored for ${identity} yet. Events are buffered by the SDK; try again in a few seconds.`,
    };
  }

  const exposures = fresh.filter((r) => r.event === EXPOSURE_EVENT_NAME && r.featureName === opts.flag);
  const bound = opts.experimentId === undefined ? exposures : exposures.filter((r) => experimentIdOf(r) === opts.experimentId);
  const exposure = bound[0];
  const conversions = fresh.filter((r) => r.event === opts.event);
  const conversion = exposure ? conversions.find((r) => ms(r.at) >= ms(exposure.at)) : undefined;
  const nearMiss = fresh.find((r) => r.event !== opts.event && r.event !== EXPOSURE_EVENT_NAME && r.event.toLowerCase() === opts.event.toLowerCase());

  const problems: string[] = [];
  let failed = false;
  if (!exposure) {
    const other = exposures.filter((r) => experimentIdOf(r) !== undefined);
    const untagged = exposures.length - other.length;
    if (exposures.length && opts.experimentId !== undefined) {
      problems.push(
        untagged
          ? `the ${EXPOSURE_EVENT_NAME} for "${opts.flag}" carries no experiment_id, so it cannot be tied to experiment ${opts.experimentId}`
          : `the ${EXPOSURE_EVENT_NAME} for "${opts.flag}" belongs to experiment ${experimentIdOf(other[0]!)}, not ${opts.experimentId}`,
      );
    } else problems.push(`no ${EXPOSURE_EVENT_NAME} for "${opts.flag}" yet`);
  }
  if (!conversion) {
    if (nearMiss && !conversions.length) {
      problems.push(`conversion stored as "${nearMiss.event}", the metric counts "${opts.event}"`);
      failed = true;
    } else if (exposure && conversions.length) {
      problems.push('the conversion was stored before the exposure, so it is not attributed');
      failed = true;
    } else problems.push(`no "${opts.event}" event yet`);
  }

  const out: IdentityEventsVerdict = { ...base, status: problems.length ? (failed ? 'FAILED' : 'PENDING') : 'IDENTITY_VERIFIED', problems, message: '' };
  if (exposure) out.exposure = exposure;
  if (conversion) out.conversion = conversion;
  const window = opts.since ? ` since ${opts.since}` : '';
  out.message = problems.length
    ? `Stored events for ${identity}${window} ${failed ? 'show a broken pipeline' : 'do not complete the pipeline yet'}: ${problems.join('; ')}.`
    : `Exposure (${exposure!.value || 'variant'}${opts.experimentId !== undefined ? `, experiment ${opts.experimentId}` : ''}) and "${opts.event}" are stored for ${identity}${window}, in order.`;
  return out;
}

/** The SQL the CLI runs against a Flagsmith-database event store. Values go in as psql variables, never spliced. */
export const IDENTITY_EVENTS_SQL =
  "select event, coalesce(feature_name, ''), to_char(timestamp at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'), coalesce(value, ''), coalesce(metadata, '') " +
  "from experimentation_sdkexperimentationevent where identifier = :'identity' and environment_key = :'env' order by timestamp, id;";

/** A stable, non-reversible tag for an environment key, so evidence can be bound to it without storing the key. */
export function keyFingerprint(key: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `fnv1a:${h.toString(16).padStart(8, '0')}`;
}
