import { resolve } from 'node:path';
import { compareReports, nextStep, redactDeep, type PipelineProbe } from '@experiment-doctor/core';
import { experimentId, parse, TARGET_OPTIONS, UsageError } from '../args';
import { makePalette } from '../color';
import type { Io } from '../io';
import { renderPipeline, renderVerification } from '../render';
import { loadState, STATE_DIR, type SavedReport } from '../state';
import { performCheck } from './check';
import type { CanaryResult } from './canary';

export const VERIFY_HELP = `experiment-doctor verify: re-run the check and compare with the last report

Usage: experiment-doctor verify [--dir <path>] [--json]

Reads ${STATE_DIR}/last-report.json (written by check and fix, never by verify),
runs the same check again and reports
three separate answers (never one combined green check):

  patch       PATCH_VERIFIED     the targeted finding is gone and its check passes
              PATCH_FAILED       it is still there, or the change caused a new finding
              PATCH_UNVERIFIED   it no longer shows, but its check could not run
              NO_PATCH_TARGET    the last report had nothing to repair
  pipeline    PIPELINE_VERIFIED  identity-level proof that an exposure and a conversion
                                 were stored (only from a probe that can read them back)
              PIPELINE_UNVERIFIED anything less (static checks and ingestion 2xx are not proof)
  experiment  EXPERIMENT_HEALTHY | EXPERIMENT_PENDING | EXPERIMENT_REPAIR_REQUIRED |
              EXPERIMENT_UNVERIFIABLE (the fresh report's verdict)

Exit code 1 when PATCH_FAILED.`;

/** The last canary, as pipeline evidence. Ingestion-only results are never identity-level. */
export function probeFromCanary(saved: (CanaryResult & { at?: string }) | null): PipelineProbe | null {
  if (!saved?.identity || !saved.at) return null;
  return {
    status: saved.status === 'ACCEPTED' ? 'ACCEPTED' : saved.status === 'FAILED' ? 'FAILED' : 'PENDING',
    at: saved.at,
    identity: saved.identity,
    identityLevel: false,
  };
}

export async function verifyCommand(io: Io, argv: string[]): Promise<number> {
  const { values } = parse(argv, TARGET_OPTIONS);
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
  const probe = probeFromCanary(loadState<CanaryResult & { at?: string }>(root, 'canary.json'));
  const v = compareReports(prev.report, run.report, probe);
  const secrets = run.envKey ? [run.envKey] : [];
  if (values.json) {
    io.stdout.write(`${JSON.stringify(redactDeep({ ...v, summary: run.report.summary, next: nextStep(run.report), notes: run.notes }, secrets))}\n`);
  } else {
    const c = makePalette(io.env, io.stdout.isTTY);
    io.stdout.write(`${renderVerification(v, c)}\n${renderPipeline(redactDeep(run.report, secrets), c)}\n\n`);
    for (const n of run.notes) io.stdout.write(`  ${c.muted(n)}\n`);
  }
  return v.patch.status === 'PATCH_FAILED' ? 1 : 0;
}
