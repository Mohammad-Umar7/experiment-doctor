import type { Report, RuleId, Verdict } from './types';

export type RepairStatus = 'VERIFIED' | 'FAILED' | 'PENDING';

export interface Comparison {
  status: RepairStatus;
  /** The finding the last report asked to repair. */
  target: RuleId | null;
  resolved: RuleId[];
  remaining: RuleId[];
  introduced: RuleId[];
  verdictBefore: Verdict;
  verdictAfter: Verdict;
  message: string;
}

const defects = (r: Report) => [...new Set(r.findings.filter((f) => f.kind === 'defect' && f.severity !== 'info').map((f) => f.id))];

/**
 * Compares a fresh report with the previous one. VERIFIED needs positive
 * evidence (the target check now passes); a check that can no longer run is
 * PENDING, never VERIFIED.
 */
export function compareReports(before: Report, after: Report): Comparison {
  const was = defects(before);
  const now = defects(after);
  const resolved = was.filter((id) => !now.includes(id));
  const remaining = now.filter((id) => was.includes(id));
  const introduced = now.filter((id) => !was.includes(id));
  const target = before.primaryFinding && before.primaryFinding.kind === 'defect' ? before.primaryFinding.id : null;
  const base = { target, resolved, remaining, introduced, verdictBefore: before.verdict, verdictAfter: after.verdict };
  const next = after.primaryFinding;

  if (!target) {
    if (after.verdict === 'HEALTHY') return { ...base, status: 'VERIFIED', message: 'The experiment is healthy.' };
    if (after.verdict === 'REPAIR_REQUIRED') return { ...base, status: 'FAILED', message: `New problem: ${next!.id} ${next!.title}.` };
    return { ...base, status: 'PENDING', message: after.summary };
  }
  if (now.includes(target)) {
    return { ...base, status: 'FAILED', message: `${target} is still there: ${after.findings.find((f) => f.id === target)!.title}.` };
  }
  if (introduced.length) {
    return { ...base, status: 'FAILED', message: `${target} is gone, but ${introduced.join(', ')} appeared: ${after.findings.find((f) => f.id === introduced[0])!.title}.` };
  }
  const check = after.checks.find((c) => c.id === target);
  if (check?.status !== 'pass') {
    return { ...base, status: 'PENDING', message: `${target} no longer shows, but its check could not run (${check?.note ?? 'no evidence'}), so the repair is not verified.` };
  }
  const tail =
    after.verdict === 'HEALTHY'
      ? ' The experiment is healthy.'
      : after.verdict === 'PENDING'
        ? ' The pipeline is waiting for data.'
        : next && next.kind === 'defect'
          ? ` Next: ${next.id} ${next.title}.`
          : '';
  return { ...base, status: 'VERIFIED', message: `${target} is fixed: its check now passes.${tail}` };
}
