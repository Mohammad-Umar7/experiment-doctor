import { resolve } from 'node:path';
import {
  DEFAULT_EVENTS_API_URL,
  DEFAULT_SDK_API_URL,
  EXPOSURE_EVENT_NAME,
  TOOL_VERSION,
  ensureTrailingSlash,
  eventsEndpoint,
  originOf,
  redactDeep,
  scanFiles,
  stringLiteral,
  type ConfigEvidence,
} from '@experiment-doctor/core';
import { experimentId, parse, UsageError } from '../args';
import { makePalette } from '../color';
import { readSourceFiles } from '../files';
import { collectConfig } from '../flagsmith';
import type { Io } from '../io';
import { authorizeMutation, loadPolicy, POLICY_FILE } from '../safety';
import { saveState } from '../state';
import { describeEventStore, parseEventStore, readIdentityEvents, type EventStoreSpec } from '../event-store';
import { evaluateIdentityEvents } from '@experiment-doctor/core';

export const CANARY_HELP = `experiment-doctor canary: active ingestion probe, only with your confirmation

Usage: experiment-doctor canary --environment <name|key> --allow-env <name|key> [options]

  --environment <name|key> the environment to probe (required, you name it)
  --allow-env <name|key>   allowlist this environment for changes (repeatable), or
                           list it under "allowMutations" in ${POLICY_FILE}
  --flag <key>             experiment flag (default: from the experiment)
  --experiment <id>        experiment id
  --event <name>           conversion event (default: the experiment's first metric)
  --dir <path>             app code, used to find the events URL your app uses (default: .)
  --events-url <url>       override the events URL (the SDK's eventsApiUrl)
  --sdk-url <url>          override the SDK API URL (the SDK's api)
  --event-store <spec>     read the canary's own events back from a Flagsmith-database
                           event store (self-hosted): docker:<compose project>[/<service>]
                           or psql:<postgres url>. Enables VERIFIED.
  --wait <seconds>         how long to look for the events in the event store (default 20)
  --yes                    skip the typed confirmation (never skips the allowlist)
  --dry-run                print the plan and stop
  --json                   machine output

What it does: reads the flags of a new identity doctor-canary-<random> over
the SDK HTTP API, then posts one exposure and one conversion for it to the
events endpoint, exactly as the SDKs do. The identity stays in that
environment's data.

What it proves: Flagsmith ingestion over HTTP. It does NOT exercise your app's
own SDK instrumentation (that is what check's code rules are for). Flagsmith's
API has no identity-level read, so without --event-store it cannot prove the
events were stored. Result:
  VERIFIED  --event-store holds this identity's exposure, then its conversion
  ACCEPTED  ingestion answered 2xx and accepted both events (storage not proven)
  FAILED    rejected, unreachable, not served, no variation key, or stored wrongly
  PENDING   nothing conclusive (outside the rollout, or not in the store yet)`;

export type CanaryStatus = 'VERIFIED' | 'ACCEPTED' | 'FAILED' | 'PENDING';

export interface CanaryResult {
  status: CanaryStatus;
  identity: string;
  environment: string;
  /** True only when --event-store returned this identity's own events. */
  identityLevel: boolean;
  /** What the probe exercised. */
  scope: 'ingestion-http';
  steps: { step: string; ok: boolean | null; detail: string; ms?: number }[];
  message: string;
  maxLatencyMs: number;
}

interface IdentityFlag {
  feature?: { name?: string };
  variant?: string;
  enabled?: boolean;
  metadata?: { experiment?: { id?: number; in_experiment?: boolean } };
}

const SCOPE_NOTE = 'This probe exercises Flagsmith ingestion over HTTP, not your app\'s SDK instrumentation.';
const NO_READBACK = 'Flagsmith offers no identity-level read, so storage of these two events cannot be proven here: refresh the results later and look for the exposure.';

export async function canaryCommand(io: Io, argv: string[]): Promise<number> {
  const { values } = parse(argv, {
    environment: { type: 'string' },
    'allow-env': { type: 'string', multiple: true },
    flag: { type: 'string' },
    experiment: { type: 'string' },
    event: { type: 'string' },
    dir: { type: 'string' },
    'events-url': { type: 'string' },
    'sdk-url': { type: 'string' },
    'event-store': { type: 'string' },
    wait: { type: 'string', default: '20' },
    yes: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  });
  if (values.help) {
    io.stdout.write(`${CANARY_HELP}\n`);
    return 0;
  }
  if (!values.environment) throw new UsageError('canary needs --environment <name|key>: name the environment you want to probe.');
  const store = values['event-store'] ? parseEventStore(values['event-store']) : null;
  const waitSeconds = Number(values.wait);
  if (!Number.isFinite(waitSeconds) || waitSeconds < 0 || waitSeconds > 600) throw new UsageError('--wait must be between 0 and 600 seconds');
  const c = makePalette(io.env, io.stdout.isTTY);
  const say = (s: string) => {
    if (!values.json) io.stdout.write(`${s}\n`);
  };
  const root = values.dir ? resolve(io.cwd, values.dir) : io.cwd;

  const collected = await collectConfig(io, { dir: root, flag: values.flag, experimentId: experimentId(values.experiment), environment: values.environment });
  const config = collected.config;
  const envKey = collected.envKey;
  if (!config || !envKey || !config.environment) {
    throw new UsageError(`Cannot reach environment "${values.environment}" through the Flagsmith CLI.\n${collected.problems.join('\n')}`);
  }
  const envName = config.environment.name;
  const auth = authorizeMutation(loadPolicy(root, values['allow-env'] ?? []), { name: envName, key: envKey });
  const flag = values.flag ?? config.flag?.name;
  const event = values.event ?? config.metrics?.[0]?.event;
  if (!flag) throw new UsageError('No experiment flag found: pass --flag <key>.');
  if (!event) throw new UsageError('No metric event found: pass --event <name>.');

  const urls = endpoints(config, root, values['sdk-url'], values['events-url']);
  const identity = `doctor-canary-${io.randomHex(4)}`;
  say(
    [
      '',
      `  ${c.accent('◆')} ${c.bold('Canary probe')} → environment ${c.bold(`"${envName}"`)}`,
      `  ${c.muted(SCOPE_NOTE)}`,
      `  identity  ${identity}  ${c.muted("(it will appear in this environment's identities and experiment data)")}`,
      `  1. GET  ${urls.sdk}identities/?identifier=${identity}   ${c.muted('reads its flags (creates the identity)')}`,
      `  2. POST ${eventsEndpoint(urls.events)}   ${c.muted(`1 ${EXPOSURE_EVENT_NAME} for "${flag}" + 1 "${event}"`)}`,
      store ? `  3. read back from ${describeEventStore(store)}   ${c.muted(`read only, up to ${waitSeconds}s`)}` : `  ${c.muted('No --event-store: the best possible result is ACCEPTED (ingestion), not VERIFIED (stored).')}`,
      `  ${auth.ok ? c.healthy(`allowlisted (${auth.matched})`) : c.critical('not allowlisted')}${auth.ok && auth.warning ? `  ${c.warning(auth.warning)}` : ''}`,
      '',
    ].join('\n'),
  );
  if (values['dry-run']) {
    if (values.json) {
      io.stdout.write(`${JSON.stringify({ status: 'DRY_RUN', identity, environment: envName, allowed: auth.ok, scope: 'ingestion-http', sdkUrl: urls.sdk, eventsEndpoint: eventsEndpoint(urls.events), flag, event })}\n`);
    }
    return 0;
  }
  if (!auth.ok) throw new UsageError(auth.reason);
  if (!values.yes) {
    const answer = (await io.prompt(`  Type the environment name ("${envName}") to send the probe: `)).trim();
    if (answer !== envName) {
      say(`  ${c.muted('·')} Cancelled. Nothing was sent.`);
      if (values.json) io.stdout.write(`${JSON.stringify({ status: 'CANCELLED', identity, environment: envName })}\n`);
      return 0;
    }
  }

  const result = await probe(io, { envKey, envName, flag, event, identity, urls });
  if (store && result.status === 'ACCEPTED') await readBack(io, store, result, { envKey, flag, event, waitSeconds });
  saveState(root, 'canary.json', { at: io.now().toISOString(), ...result }, [envKey]);
  if (values.json) {
    io.stdout.write(`${JSON.stringify(redactDeep(result, [envKey]))}\n`);
  } else {
    for (const s of result.steps) say(`  ${s.ok === true ? c.healthy('✓') : s.ok === false ? c.critical('✕') : c.warning('◔')} ${s.step}  ${c.muted(s.detail)}${s.ms !== undefined ? c.muted(` (${s.ms} ms)`) : ''}`);
    const badge =
      result.status === 'VERIFIED'
        ? c.healthy(c.bold('✓ VERIFIED'))
        : result.status === 'ACCEPTED'
          ? c.info(c.bold('→ ACCEPTED'))
          : result.status === 'FAILED'
            ? c.critical(c.bold('✕ FAILED'))
            : c.warning(c.bold('◔ PENDING'));
    say(`\n  ${badge}  ${result.message}\n`);
    if (config.environment.selfHosted && result.maxLatencyMs >= 2500) {
      say(`  ${c.warning('!')} A request took ${result.maxLatencyMs} ms. Symptoms may be consistent with Flagsmith issue #9132 (Postgres JIT, open). Confirm the slow statement before applying its workaround (postgres -c jit=off).\n`);
    }
  }
  return result.status === 'FAILED' ? 1 : 0;
}

interface Urls {
  sdk: string;
  events: string;
}

/** Prefer the URLs the app itself uses, so the probe also tests its transport config. */
function endpoints(config: ConfigEvidence, root: string, sdkOverride?: string, eventsOverride?: string): Urls {
  const code = scanFiles(readSourceFiles(root));
  const init = code.inits[0];
  const env = config.environment!;
  const origin = env.selfHosted && env.apiUrl ? originOf(env.apiUrl) : null;
  const appApi = stringLiteral(init?.apiUrl ?? null);
  const appEvents = stringLiteral(init?.eventsApiUrl ?? null);
  const sdk = sdkOverride ?? appApi ?? (origin ? `${origin}/api/v1/` : DEFAULT_SDK_API_URL);
  const events = eventsOverride ?? appEvents ?? (origin ? `${origin}/api/` : DEFAULT_EVENTS_API_URL);
  return { sdk: ensureTrailingSlash(sdk), events: ensureTrailingSlash(events) };
}

async function timed<T>(io: Io, f: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const t0 = io.now().getTime();
  const value = await f();
  return { value, ms: Math.max(0, io.now().getTime() - t0) };
}

async function probe(io: Io, p: { envKey: string; envName: string; flag: string; event: string; identity: string; urls: Urls }): Promise<CanaryResult> {
  const steps: CanaryResult['steps'] = [];
  let max = 0;
  const done = (status: CanaryStatus, message: string): CanaryResult => ({
    status,
    identity: p.identity,
    environment: p.envName,
    identityLevel: false as boolean,
    scope: 'ingestion-http' as const,
    steps,
    message,
    maxLatencyMs: max,
  });
  const headers = { 'X-Environment-Key': p.envKey, 'Content-Type': 'application/json; charset=utf-8', 'Flagsmith-SDK-User-Agent': `experiment-doctor-canary/${TOOL_VERSION}` };

  // 1. Identity flags: is the canary enrolled, and in which variation?
  let flag: IdentityFlag | undefined;
  try {
    const { value: res, ms } = await timed(io, () => io.fetch(`${p.urls.sdk}identities/?identifier=${encodeURIComponent(p.identity)}`, { headers }));
    max = Math.max(max, ms);
    if (!res.ok) {
      steps.push({ step: 'Read identity flags', ok: false, detail: `HTTP ${res.status}`, ms });
      return done('FAILED', res.status === 401 || res.status === 403 ? 'The SDK API refused the environment key.' : `The SDK API answered HTTP ${res.status}.`);
    }
    const body = (await res.json()) as { flags?: IdentityFlag[] };
    flag = body.flags?.find((f) => f.feature?.name === p.flag);
    steps.push({ step: 'Read identity flags', ok: true, detail: flag ? `variation "${flag.variant ?? 'none'}"` : `flag "${p.flag}" not returned`, ms });
  } catch (err) {
    steps.push({ step: 'Read identity flags', ok: false, detail: err instanceof Error ? err.message : String(err) });
    return done('FAILED', `Cannot reach the SDK API at ${p.urls.sdk}.`);
  }
  if (!flag) return done('FAILED', `Flag "${p.flag}" is not served in "${p.envName}".`);
  const exp = flag.metadata?.experiment;
  if (!exp) return done('FAILED', `No running experiment is attached to "${p.flag}" (the flag has no experiment metadata).`);
  if (!exp.in_experiment) return done('PENDING', 'The canary identity is outside the experiment rollout, so no exposure was sent. Nothing is proven either way: run the canary again, or check the rollout.');
  if (!flag.variant) return done('FAILED', 'The served variation has no key, so its exposure cannot be counted (see ED-001).');

  // 2. Send one exposure and one conversion, like the SDK's event processor.
  const now = io.now().getTime();
  const meta = { experiment_id: exp.id ?? null, sdk_version: `experiment-doctor-canary/${TOOL_VERSION}` };
  const events = [
    { event: EXPOSURE_EVENT_NAME, feature_name: p.flag, identifier: p.identity, value: flag.variant, traits: null, metadata: meta, timestamp: now },
    { event: p.event, feature_name: null, identifier: p.identity, value: null, traits: null, metadata: meta, timestamp: now + 1 },
  ];
  try {
    const { value: res, ms } = await timed(io, () => io.fetch(eventsEndpoint(p.urls.events), { method: 'POST', headers, body: JSON.stringify({ events }) }));
    max = Math.max(max, ms);
    type Batch = { accepted?: number; rejected?: { index: number; error: string }[]; detail?: string };
    const body: Batch | null = await res.json().then(
      (j: unknown) => (j && typeof j === 'object' ? (j as Batch) : null),
      () => null, // some answers are plain text
    );
    if (!res.ok) {
      steps.push({ step: 'Send exposure + conversion', ok: false, detail: `HTTP ${res.status}${body?.detail ? `: ${body.detail}` : ''}`, ms });
      return done(
        'FAILED',
        res.status === 404
          ? `The events endpoint ${eventsEndpoint(p.urls.events)} does not take events for this environment (wrong events URL or no warehouse: ED-006 / ED-007).`
          : `The events API rejected the batch (HTTP ${res.status}).`,
      );
    }
    const rejected = body?.rejected ?? [];
    const accepted = body?.accepted;
    steps.push({ step: 'Send exposure + conversion', ok: rejected.length === 0 && accepted === 2 ? true : rejected.length ? false : null, detail: `HTTP ${res.status}, accepted ${accepted ?? 'unknown'}${rejected.length ? `, rejected: ${rejected.map((r) => r.error).join('; ')}` : ''}`, ms });
    if (rejected.length) return done('FAILED', `Flagsmith rejected ${rejected.length} event(s): ${rejected[0]!.error}`);
    if (accepted !== 2) return done('PENDING', `Ingestion answered HTTP ${res.status} without confirming both events were accepted. ${NO_READBACK}`);
  } catch (err) {
    steps.push({ step: 'Send exposure + conversion', ok: false, detail: err instanceof Error ? err.message : String(err) });
    return done('FAILED', `Cannot reach the events API at ${eventsEndpoint(p.urls.events)}.`);
  }
  return done('ACCEPTED', `Ingestion accepted the exposure and the conversion for ${p.identity}. ${NO_READBACK} ${SCOPE_NOTE}`);
}

/** Reads the canary's own events back from the event store. Identity-level, never aggregate. */
async function readBack(io: Io, store: EventStoreSpec, result: CanaryResult, p: { envKey: string; flag: string; event: string; waitSeconds: number }): Promise<void> {
  const deadline = io.now().getTime() + p.waitSeconds * 1000;
  for (;;) {
    const read = await readIdentityEvents(io, store, result.identity, p.envKey);
    if (!read.ok) {
      result.steps.push({ step: 'Read back from the event store', ok: false, detail: read.error });
      result.message = `${result.message} The event store could not be read (${read.error}), so the result stays ACCEPTED.`;
      return;
    }
    const verdict = evaluateIdentityEvents(result.identity, read.rows, { flag: p.flag, event: p.event });
    if (verdict.status !== 'PENDING' || io.now().getTime() >= deadline) {
      result.identityLevel = verdict.status !== 'PENDING';
      result.steps.push({ step: 'Read back from the event store', ok: verdict.status === 'IDENTITY_VERIFIED' ? true : verdict.status === 'FAILED' ? false : null, detail: `${read.rows.length} event(s) stored for ${result.identity}` });
      if (verdict.status === 'IDENTITY_VERIFIED') {
        result.status = 'VERIFIED';
        result.message = `${verdict.message} ${SCOPE_NOTE}`;
      } else if (verdict.status === 'FAILED') {
        result.status = 'FAILED';
        result.message = verdict.message;
      } else {
        result.status = 'PENDING';
        result.message = `Ingestion accepted both events, but none is in the event store after ${p.waitSeconds}s. Run the canary again, or check the warehouse delivery.`;
      }
      return;
    }
    await io.sleep(2000);
  }
}
