import {
  DEFAULT_EVENTS_API_URL,
  DEFAULT_SDK_API_URL,
  EXPOSURE_EVENT_NAME,
  TOOL_VERSION,
  ensureTrailingSlash,
  eventsEndpoint,
  mapWarehouses,
  originOf,
  redactDeep,
  scanFiles,
  stringLiteral,
  type ConfigEvidence,
} from '@experiment-doctor/core';
import { resolve } from 'node:path';
import { experimentId, parse, UsageError } from '../args';
import { makePalette } from '../color';
import { readSourceFiles } from '../files';
import { collectConfig, FlagsmithCli } from '../flagsmith';
import type { Io } from '../io';
import { looksLikeProduction } from '../safety';
import { saveState } from '../state';

export const CANARY_HELP = `experiment-doctor canary: active probe, only with your confirmation

Usage: experiment-doctor canary --environment <name|key> [options]

  --environment <name|key> the environment to probe (required, you name it)
  --flag <key>             experiment flag (default: from the experiment)
  --experiment <id>        experiment id
  --event <name>           conversion event (default: the experiment's first metric)
  --dir <path>             app code, used to find the events URL your app uses (default: .)
  --events-url <url>       override the events URL (the SDK's eventsApiUrl)
  --sdk-url <url>          override the SDK API URL (the SDK's api)
  --wait <seconds>         how long to watch for arrival (default 60)
  --yes                    skip the typed confirmation
  --dry-run                print the plan and stop
  --allow-production       allow an environment that looks like production
  --json                   machine output

Sends one exposure and one conversion for a new identity named
doctor-canary-<random>, using the same HTTP endpoints the SDKs use, then watches
the warehouse for them. The identity stays in that environment's data.
Result: VERIFIED (events arrived), FAILED (rejected or unreachable),
PENDING (accepted, not visible yet: processing delay is normal).`;

export type CanaryStatus = 'VERIFIED' | 'FAILED' | 'PENDING';

export interface CanaryResult {
  status: CanaryStatus;
  identity: string;
  environment: string;
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

export async function canaryCommand(io: Io, argv: string[]): Promise<number> {
  const { values } = parse(argv, {
    environment: { type: 'string' },
    flag: { type: 'string' },
    experiment: { type: 'string' },
    event: { type: 'string' },
    dir: { type: 'string' },
    'events-url': { type: 'string' },
    'sdk-url': { type: 'string' },
    wait: { type: 'string', default: '60' },
    yes: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    'allow-production': { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  });
  if (values.help) {
    io.stdout.write(`${CANARY_HELP}\n`);
    return 0;
  }
  if (!values.environment) throw new UsageError('canary needs --environment <name|key>: name the environment you want to probe.');
  const waitSeconds = Number(values.wait);
  if (!Number.isFinite(waitSeconds) || waitSeconds < 0 || waitSeconds > 900) throw new UsageError('--wait must be between 0 and 900 seconds');
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
  if (looksLikeProduction(envName) && !values['allow-production']) {
    throw new UsageError(`"${envName}" looks like production. The canary writes an identity and events there. Use a test environment, or pass --allow-production.`);
  }
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
      `  identity  ${identity}  ${c.muted('(it will appear in this environment\'s identities and experiment data)')}`,
      `  1. GET  ${urls.sdk}identities/?identifier=${identity}   ${c.muted('reads its flags (creates the identity)')}`,
      `  2. POST ${eventsEndpoint(urls.events)}   ${c.muted(`1 ${EXPOSURE_EVENT_NAME} for "${flag}" + 1 "${event}"`)}`,
      `  3. watch warehouse-connections for up to ${waitSeconds}s   ${c.muted('read only')}`,
      '',
    ].join('\n'),
  );
  if (values['dry-run']) {
    if (values.json) io.stdout.write(`${JSON.stringify({ status: 'DRY_RUN', identity, environment: envName, sdkUrl: urls.sdk, eventsEndpoint: eventsEndpoint(urls.events), flag, event })}\n`);
    return 0;
  }
  if (!values.yes) {
    const answer = (await io.prompt(`  Type the environment name ("${envName}") to send the probe: `)).trim();
    if (answer !== envName) {
      say(`  ${c.muted('·')} Cancelled. Nothing was sent.`);
      if (values.json) io.stdout.write(`${JSON.stringify({ status: 'CANCELLED', identity, environment: envName })}\n`);
      return 0;
    }
  }

  const result = await probe(io, { envKey, envName, flag, event, identity, urls, waitSeconds, baseline: config.warehouses?.find((w) => w.status === 'connected')?.totalEventsReceived ?? null });
  saveState(root, 'canary.json', { at: io.now().toISOString(), ...result }, [envKey]);
  if (values.json) {
    io.stdout.write(`${JSON.stringify(redactDeep(result, [envKey]))}\n`);
  } else {
    for (const s of result.steps) say(`  ${s.ok === true ? c.healthy('✓') : s.ok === false ? c.critical('✕') : c.warning('◔')} ${s.step}  ${c.muted(s.detail)}${s.ms !== undefined ? c.muted(` (${s.ms} ms)`) : ''}`);
    const badge = result.status === 'VERIFIED' ? c.healthy(c.bold('✓ VERIFIED')) : result.status === 'FAILED' ? c.critical(c.bold('✕ FAILED')) : c.warning(c.bold('◔ PENDING'));
    say(`\n  ${badge}  ${result.message}\n`);
    if (config.environment.selfHosted && result.maxLatencyMs >= 2500) {
      say(`  ${c.warning('!')} A request took ${result.maxLatencyMs} ms. Possible upstream bug: Flagsmith #9132 (Postgres JIT). Workaround: run postgres with -c jit=off.\n`);
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

async function probe(
  io: Io,
  p: { envKey: string; envName: string; flag: string; event: string; identity: string; urls: Urls; waitSeconds: number; baseline: number | null },
): Promise<CanaryResult> {
  const steps: CanaryResult['steps'] = [];
  let max = 0;
  const done = (status: CanaryStatus, message: string): CanaryResult => ({ status, identity: p.identity, environment: p.envName, steps, message, maxLatencyMs: max });
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
  if (!exp.in_experiment) return done('PENDING', 'The canary identity is outside the experiment rollout, so no exposure was sent. Run the canary again, or raise the rollout.');
  if (!flag.variant) return done('FAILED', 'The served variation has no key, so its exposure cannot be counted (see ED-001).');

  // 2. Send one exposure and one conversion, like the SDK's event processor.
  const now = io.now().getTime();
  const meta = { experiment_id: exp.id ?? null, sdk_version: `experiment-doctor-canary/${TOOL_VERSION}` };
  const events = [
    { event: EXPOSURE_EVENT_NAME, feature_name: p.flag, identifier: p.identity, value: flag.variant, traits: null, metadata: meta, timestamp: now },
    { event: p.event, feature_name: null, identifier: p.identity, value: null, traits: null, metadata: meta, timestamp: now + 1 },
  ];
  const sentAt = new Date(now).toISOString();
  try {
    const { value: res, ms } = await timed(io, () => io.fetch(eventsEndpoint(p.urls.events), { method: 'POST', headers, body: JSON.stringify({ events }) }));
    max = Math.max(max, ms);
    let body: { accepted?: number; rejected?: { index: number; error: string }[]; detail?: string } = {};
    try {
      body = (await res.json()) as typeof body;
    } catch {
      // some errors are plain text
    }
    if (!res.ok) {
      steps.push({ step: 'Send exposure + conversion', ok: false, detail: `HTTP ${res.status}${body.detail ? `: ${body.detail}` : ''}`, ms });
      return done('FAILED', res.status === 404 ? `The events endpoint ${eventsEndpoint(p.urls.events)} does not take events for this environment (wrong events URL or no warehouse: ED-006 / ED-007).` : `The events API rejected the batch (HTTP ${res.status}).`);
    }
    const rejected = body.rejected ?? [];
    steps.push({ step: 'Send exposure + conversion', ok: rejected.length === 0, detail: `HTTP ${res.status}, accepted ${body.accepted ?? '?'}${rejected.length ? `, rejected: ${rejected.map((r) => r.error).join('; ')}` : ''}`, ms });
    if (rejected.length) return done('FAILED', `Flagsmith rejected ${rejected.length} event(s): ${rejected[0]!.error}`);
  } catch (err) {
    steps.push({ step: 'Send exposure + conversion', ok: false, detail: err instanceof Error ? err.message : String(err) });
    return done('FAILED', `Cannot reach the events API at ${eventsEndpoint(p.urls.events)}.`);
  }

  // 3. Watch the warehouse for arrival. A delay is not a failure.
  const cli = new FlagsmithCli(io);
  cli.addSecret(p.envKey);
  const deadline = io.now().getTime() + p.waitSeconds * 1000;
  let supported = true;
  for (;;) {
    try {
      const w = mapWarehouses(await cli.api(`api/v1/environments/${p.envKey}/warehouse-connections/`)).find((x) => x.status === 'connected');
      const total = w?.totalEventsReceived;
      if (total === undefined || total === null) supported = false;
      else if ((p.baseline !== null && total >= p.baseline + 2) || (w?.lastEventAt && w.lastEventAt >= sentAt)) {
        steps.push({ step: 'Events reached the warehouse', ok: true, detail: `total_events_received ${p.baseline ?? '?'} → ${total}` });
        return done('VERIFIED', `The exposure and the conversion for ${p.identity} reached the warehouse.`);
      }
    } catch {
      supported = false;
    }
    if (!supported || io.now().getTime() >= deadline) break;
    await io.sleep(10_000);
  }
  steps.push({ step: 'Events reached the warehouse', ok: null, detail: supported ? `not visible after ${p.waitSeconds}s` : 'this warehouse does not report event counts' });
  return done(
    'PENDING',
    supported
      ? 'Accepted by Flagsmith but not visible yet. Processing can take minutes: run the canary again later or watch the experiment\'s Exposures panel.'
      : 'Accepted by Flagsmith (HTTP 2xx). This warehouse does not report event counts, so arrival cannot be confirmed here: check the experiment\'s Exposures panel.',
  );
}
