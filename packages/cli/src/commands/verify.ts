import { resolve } from 'node:path';
import { compareReports, evaluateIdentityEvents, nextStep, redactDeep, type PipelineProbe } from '@experiment-doctor/core';
import { experimentId, parse, TARGET_OPTIONS, UsageError } from '../args';
import { makePalette } from '../color';
import type { Io } from '../io';
import { renderPipeline, renderVerification } from '../render';
import { loadState, STATE_DIR, type SavedReport } from '../state';
import { performCheck } from './check';
import type { CanaryResult } from './canary';
import { parseEventStore, readIdentityEvents } from '../event-store';
import { findFlagsmithJson } from '../flagsmith';
import { looksLikeEnvKey } from '../safety';

export const VERIFY_HELP = `experiment-doctor verify: re-run the check and compare with the last report

Usage: experiment-doctor verify [--dir <path>] [--json]
                                [--event-store <spec> --identity <id> [--event <name>]]

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

Exit code 1 when PATCH_FAILED or PIPELINE_FAILED.`;

/** The last canary, as pipeline evidence. Ingestion-only results are never identity-level. */
export function probeFromCanary(saved: (CanaryResult & { at?: string }) | null): PipelineProbe | null {
  if (!saved?.identity || !saved.at) return null;
  const verified = saved.status === 'VERIFIED' && saved.identityLevel === true;
  return {
    status: verified ? 'IDENTITY_VERIFIED' : saved.status === 'ACCEPTED' ? 'ACCEPTED' : saved.status === 'FAILED' ? 'FAILED' : 'PENDING',
    at: saved.at,
    identity: saved.identity,
    identityLevel: verified,
    scope: 'ingestion-http',
    detail: saved.message,
  };
}

export async function verifyCommand(io: Io, argv: string[]): Promise<number> {
  const { values } = parse(argv, {
    ...TARGET_OPTIONS,
    'event-store': { type: 'string' },
    identity: { type: 'string' },
    event: { type: 'string' },
  });
  if (!!values.identity !== !!values['event-store']) throw new UsageError('--identity and --event-store go together: the identity is read back from that event store.');
  const store = values['event-store'] ? parseEventStore(values['event-store']) : null;
  if (values.help) {
    io.stdout.write(`${VERIFY_HELP}\n`);
    return 0;
  }
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
  let probe = probeFromCanary(loadState<CanaryResult & { at?: string }>(root, 'canary.json'));
  if (store && values.identity) {
    // A real user's own events: identity-level evidence for the app's SDK path.
    const fsKey = findFlagsmithJson(root)?.environment;
    const envKey = run.envKey ?? (values.environment && looksLikeEnvKey(values.environment) ? values.environment : undefined) ?? (fsKey && looksLikeEnvKey(fsKey) ? fsKey : undefined);
    const flag = values.flag ?? run.report.target.flag;
    const event = values.event ?? run.evidence.config?.metrics?.[0]?.event;
    if (!envKey) throw new UsageError('No environment key for the event store: pass --environment <key> or run flagsmith init.');
    if (!flag || !event) throw new UsageError('Pass --flag and --event so the stored events can be checked.');
    const read = await readIdentityEvents(io, store, values.identity, envKey);
    if (!read.ok) {
      run.notes.push(`Event store: ${read.error}`);
    } else {
      const verdict = evaluateIdentityEvents(values.identity, read.rows, { flag, event });
      run.notes.push(`Event store: ${verdict.message}`);
      probe = {
        status: verdict.status,
        at: io.now().toISOString(),
        identity: values.identity,
        identityLevel: verdict.status !== 'PENDING',
        scope: 'app-sdk',
        detail: verdict.problems.join('; ') || verdict.message,
      };
    }
  }
  const v = compareReports(prev.report, run.report, probe);
  const secrets = run.envKey ? [run.envKey] : [];
  if (values.json) {
    io.stdout.write(`${JSON.stringify(redactDeep({ ...v, summary: run.report.summary, next: nextStep(run.report), notes: run.notes }, secrets))}\n`);
  } else {
    const c = makePalette(io.env, io.stdout.isTTY);
    io.stdout.write(`${renderVerification(v, c)}\n${renderPipeline(redactDeep(run.report, secrets), c)}\n\n`);
    for (const n of run.notes) io.stdout.write(`  ${c.muted(n)}\n`);
  }
  return v.patch.status === 'PATCH_FAILED' || v.pipeline.status === 'PIPELINE_FAILED' ? 1 : 0;
}
