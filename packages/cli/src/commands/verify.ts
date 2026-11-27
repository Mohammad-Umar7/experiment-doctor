import { resolve } from 'node:path';
import { compareReports, nextStep, redactDeep } from '@experiment-doctor/core';
import { experimentId, parse, TARGET_OPTIONS, UsageError } from '../args';
import { makePalette } from '../color';
import type { Io } from '../io';
import { renderComparison, renderPipeline } from '../render';
import { loadState, STATE_DIR, type SavedReport } from '../state';
import { performCheck } from './check';

export const VERIFY_HELP = `experiment-doctor verify: re-run the check and compare with the last report

Usage: experiment-doctor verify [--dir <path>] [--json]

Reads ${STATE_DIR}/last-report.json, runs the same check again and reports:
  VERIFIED  the finding is gone and its check now passes on fresh evidence
  FAILED    the finding is still there, or the change caused a new one
  PENDING   it no longer shows, but the check could not run, or data is still coming in
Exit code 1 when FAILED.`;

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
  });
  const cmp = compareReports(prev.report, run.report);
  const secrets = run.envKey ? [run.envKey] : [];
  if (values.json) {
    io.stdout.write(`${JSON.stringify(redactDeep({ ...cmp, summary: run.report.summary, next: nextStep(run.report), notes: run.notes }, secrets))}\n`);
  } else {
    const c = makePalette(io.env, io.stdout.isTTY);
    io.stdout.write(`${renderComparison(cmp, c)}\n${renderPipeline(redactDeep(run.report, secrets), c)}\n\n`);
    for (const n of run.notes) io.stdout.write(`  ${c.muted(n)}\n`);
  }
  return cmp.status === 'FAILED' ? 1 : 0;
}
