import { resolve } from 'node:path';
import { compareReports, evaluateIdentityEvents, keyFingerprint, nextStep, redactDeep, type PipelineContext, type PipelineProbe } from '@experiment-doctor/core';
import { experimentId, parse, TARGET_OPTIONS, UsageError } from '../args';
import { makePalette } from '../color';
import type { Io } from '../io';
import { renderPipeline, renderVerification } from '../render';
import { loadState, STATE_DIR, type SavedReport } from '../state';
import { performCheck } from './check';
import type { CanaryResult } from './canary';
import { parseEventStore, readIdentityEvents, type EventStoreSpec } from '../event-store';
import { findFlagsmithJson } from '../flagsmith';
import { looksLikeEnvKey } from '../safety';

export const VERIFY_HELP = `experiment-doctor verify: re-run the check and compare with the last report

Usage: experiment-doctor verify [--dir <path>] [--json]
                                [--event-store <spec> --identity <id> [--event <name>] [--wait 30]]

Reads ${STATE_DIR}/last-report.json (written by check and fix, never by verify),
runs the same check again and reports
three separate answers (never one combined green check):

  patch       PATCH_VERIFIED     the targeted finding is gone and its check passes
              PATCH_FAILED       it is still there, or the change caused a new finding
              PATCH_UNVERIFIED   it no longer shows, but its check could not run
              NO_PATCH_TARGET    the last report had nothing to repair
  pipeline    PIPELINE_VERIFIED  identity-level proof that an exposure and a conversion
                                 were stored (only from a probe that can read them back)
              PIPELINE_FAILED    a fresh probe shows the events were rejected or stored wrongly
              PIPELINE_UNVERIFIED anything less (static checks and ingestion 2xx are not proof)
  experiment  EXPERIMENT_HEALTHY | EXPERIMENT_PENDING | EXPERIMENT_REPAIR_REQUIRED |
              EXPERIMENT_UNVERIFIABLE (the fresh report's verdict)

Pipeline evidence comes from the last canary (canary.json) or, with
--event-store and --identity, from the stored events of one real user of your
app (self-hosted Flagsmith database only): that proves the app's own SDK path.
With --identity, an earlier canary is never used instead.

Evidence only counts when it matches this report's environment, experiment,
flag and metric event, and when its events are newer than the repair (the last
fix), or newer than the start of this verify run when nothing was fixed. With
--identity, verify waits up to --wait seconds for such new events.

Exit code 1 when PATCH_FAILED or PIPELINE_FAILED.`;

/** The last canary, as pipeline evidence. Ingestion-only results are never identity-level. */
export function probeFromCanary(saved: (CanaryResult & { at?: string }) | null): PipelineProbe | null {
  if (!saved?.identity || !saved.at) return null;
  const verified = saved.status === 'VERIFIED' && saved.identityLevel === true;
  const probe: PipelineProbe = {
    status: verified ? 'IDENTITY_VERIFIED' : saved.status === 'ACCEPTED' ? 'ACCEPTED' : saved.status === 'FAILED' ? 'FAILED' : 'PENDING',
    at: saved.at,
    identity: saved.identity,
    identityLevel: verified,
    scope: 'ingestion-http',
    detail: saved.message,
  };
  if (saved.binding) {
    const { sentAt, ...binding } = saved.binding;
    probe.binding = binding;
    probe.evidenceAt = saved.evidenceAt ?? sentAt ?? saved.at;
  }
  return probe;
}

/** The time evidence must postdate: the fix applied after this baseline, else the start of this run. */
export function evidenceWindow(prev: SavedReport, lastFix: { at?: string } | null, verifyStart: string): Pick<PipelineContext, 'since' | 'sinceReason'> {
  const fixedAt = lastFix?.at;
  if (fixedAt && prev.savedAt && Date.parse(fixedAt) >= Date.parse(prev.savedAt)) return { since: fixedAt, sinceReason: 'repair' };
  return { since: verifyStart, sinceReason: 'verify-start' };
}

async function identityProbe(
  io: Io,
  store: EventStoreSpec,
  identity: string,
  ctx: PipelineContext,
  envKey: string | undefined,
  waitSeconds: number,
  notes: string[],
): Promise<PipelineProbe> {
  const unavailable = (detail: string): PipelineProbe => ({ status: 'UNAVAILABLE', at: io.now().toISOString(), identity, identityLevel: false, scope: 'app-sdk', detail });
  if (!envKey) return unavailable('no environment key to read the event store with (pass --environment <key> or run flagsmith init)');
  if (!ctx.flag || !ctx.events?.length) return unavailable('the experiment flag or metric event is unknown (pass --flag and --event)');
  if (ctx.experimentId === undefined) return unavailable('the experiment id is unknown, so stored exposures cannot be tied to it (pass --experiment)');
  const deadline = io.now().getTime() + waitSeconds * 1000;
  for (;;) {
    const read = await readIdentityEvents(io, store, identity, envKey);
    if (!read.ok) return unavailable(`the event store could not be read (${read.error})`);
    const verdicts = ctx.events.map((event) => evaluateIdentityEvents(identity, read.rows, { flag: ctx.flag!, event, experimentId: ctx.experimentId, since: ctx.since }));
    const verdict = verdicts.find((x) => x.status === 'IDENTITY_VERIFIED') ?? verdicts.find((x) => x.status === 'FAILED') ?? verdicts[0]!;
    if (verdict.status !== 'PENDING' || io.now().getTime() >= deadline) {
      notes.push(`Event store: ${verdict.message}`);
      const probe: PipelineProbe = {
        status: verdict.status,
        at: io.now().toISOString(),
        identity,
        identityLevel: verdict.status !== 'PENDING',
        scope: 'app-sdk',
        detail: verdict.problems.join('; ') || verdict.message,
        binding: { envFingerprint: keyFingerprint(envKey), experimentId: ctx.experimentId, flag: ctx.flag, event: (verdict.conversion?.event ?? ctx.events[0])! },
      };
      if (verdict.exposure) probe.evidenceAt = verdict.exposure.at;
      else probe.evidenceAt = probe.at;
      return probe;
    }
    await io.sleep(2000);
  }
}

export async function verifyCommand(io: Io, argv: string[]): Promise<number> {
  const verifyStart = io.now().toISOString();
  const { values } = parse(argv, {
    ...TARGET_OPTIONS,
    'event-store': { type: 'string' },
    identity: { type: 'string' },
    event: { type: 'string' },
    wait: { type: 'string', default: '30' },
  });
  if (values.help) {
    io.stdout.write(`${VERIFY_HELP}\n`);
    return 0;
  }
  if (!!values.identity !== !!values['event-store']) throw new UsageError('--identity and --event-store go together: the identity is read back from that event store.');
  const store = values['event-store'] ? parseEventStore(values['event-store']) : null;
  const waitSeconds = Number(values.wait);
  if (!Number.isFinite(waitSeconds) || waitSeconds < 0 || waitSeconds > 600) throw new UsageError('--wait must be between 0 and 600 seconds');
  const root = values.dir ? resolve(io.cwd, values.dir) : io.cwd;
  const prev = loadState<SavedReport>(root, 'last-report.json');
  if (!prev?.report) throw new UsageError(`No ${STATE_DIR}/last-report.json in ${root}. Run experiment-doctor check first.`);

  const inv = prev.invocation ?? {};
  const run = await performCheck(io, {
    dir: root,
    flag: values.flag ?? inv.flag,
    experiment: experimentId(values.experiment) ?? inv.experiment,
    evidence: values.evidence ?? (inv.evidence ? resolve(root, inv.evidence) : undefined),
    environment: values.environment ?? inv.environment,
    // keep the baseline: verify can be re-run and always compares with the last check or fix
    save: false,
  });

  // Bind any pipeline evidence to this report and to the repair time.
  const fsKey = findFlagsmithJson(root)?.environment;
  const envKey = run.envKey ?? (values.environment && looksLikeEnvKey(values.environment) ? values.environment : undefined) ?? (fsKey && looksLikeEnvKey(fsKey) ? fsKey : undefined);
  const metricEvents = run.evidence.config?.metrics?.map((m) => m.event).filter(Boolean) ?? [];
  const ctx: PipelineContext = {
    ...evidenceWindow(prev, loadState<{ at?: string }>(root, 'last-fix.json'), verifyStart),
    events: values.event ? [values.event] : metricEvents,
  };
  if (envKey) ctx.envFingerprint = keyFingerprint(envKey);
  if (run.report.target.experimentId !== undefined) ctx.experimentId = run.report.target.experimentId;
  const flag = values.flag ?? run.report.target.flag;
  if (flag) ctx.flag = flag;

  // With --identity, only that identity's own events count: never fall back to an older canary.
  const probe =
    store && values.identity
      ? await identityProbe(io, store, values.identity, ctx, envKey, waitSeconds, run.notes)
      : probeFromCanary(loadState<CanaryResult & { at?: string }>(root, 'canary.json'));
  const v = compareReports(prev.report, run.report, probe, ctx);
  const secrets = run.envKey ? [run.envKey] : envKey ? [envKey] : [];
  if (values.json) {
    io.stdout.write(`${JSON.stringify(redactDeep({ ...v, window: { since: ctx.since, reason: ctx.sinceReason }, summary: run.report.summary, next: nextStep(run.report), notes: run.notes }, secrets))}\n`);
  } else {
    const c = makePalette(io.env, io.stdout.isTTY);
    io.stdout.write(`${renderVerification(v, c)}\n${renderPipeline(redactDeep(run.report, secrets), c)}\n\n`);
    for (const n of run.notes) io.stdout.write(`  ${c.muted(n)}\n`);
  }
  return v.patch.status === 'PATCH_FAILED' || v.pipeline.status === 'PIPELINE_FAILED' ? 1 : 0;
}
