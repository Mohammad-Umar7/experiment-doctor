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
  /** ISO timestamp, UTC. */
  at: string;
  value: string;
}

export interface IdentityEventsVerdict {
  status: 'IDENTITY_VERIFIED' | 'FAILED' | 'PENDING';
  identity: string;
  problems: string[];
  exposure?: StoredEvent;
  conversion?: StoredEvent;
  message: string;
}

/** Parses psql -At -F '\t' output: event, feature_name, timestamp, value. */
export function parseStoredEvents(tsv: string): StoredEvent[] {
  return tsv
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .map((line) => {
      const [event = '', featureName = '', at = '', value = ''] = line.split('\t');
      return { event, featureName, at, value };
    });
}

/**
 * VERIFIED only when this identity has an exposure for the flag, a conversion
 * with the metric's exact name, and the conversion comes after the exposure
 * (Flagsmith only counts post-exposure conversions).
 */
export function evaluateIdentityEvents(identity: string, rows: StoredEvent[], opts: { flag: string; event: string }): IdentityEventsVerdict {
  if (rows.length === 0) {
    return { status: 'PENDING', identity, problems: [], message: `Nothing stored for ${identity} yet. Events are buffered by the SDK; try again in a few seconds.` };
  }
  const exposure = rows.find((r) => r.event === EXPOSURE_EVENT_NAME && r.featureName === opts.flag);
  const conversion = rows.find((r) => r.event === opts.event);
  const nearMiss = rows.find((r) => r.event !== opts.event && r.event !== EXPOSURE_EVENT_NAME && r.event.toLowerCase() === opts.event.toLowerCase());
  const problems: string[] = [];
  if (!exposure) problems.push(`no ${EXPOSURE_EVENT_NAME} for "${opts.flag}"`);
  if (!conversion) problems.push(nearMiss ? `conversion stored as "${nearMiss.event}", the metric counts "${opts.event}"` : `no "${opts.event}" event stored`);
  if (exposure && conversion && conversion.at < exposure.at) problems.push('the conversion was stored before the exposure, so it is not attributed');
  const out: IdentityEventsVerdict = { status: problems.length ? 'FAILED' : 'IDENTITY_VERIFIED', identity, problems, message: '' };
  if (exposure) out.exposure = exposure;
  if (conversion) out.conversion = conversion;
  out.message = problems.length
    ? `Stored events for ${identity} do not complete the pipeline: ${problems.join('; ')}.`
    : `Exposure (${exposure!.value || 'variant'}) and "${opts.event}" are stored for ${identity}, in order.`;
  return out;
}

/** The SQL the CLI runs against a Flagsmith-database event store. Values go in as psql variables, never spliced. */
export const IDENTITY_EVENTS_SQL =
  "select event, coalesce(feature_name, ''), to_char(timestamp at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'), coalesce(value, '') " +
  "from experimentation_sdkexperimentationevent where identifier = :'identity' and environment_key = :'env' order by timestamp, id;";
