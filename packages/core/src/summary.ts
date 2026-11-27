import type { Finding, LayerStatus, PipelineNodeId, Report, RuleId, Severity, Verdict } from './types';

/**
 * The compact shape `experiment-doctor check --json` prints for agents:
 * the primary finding in full, everything else as one-liners.
 */
export interface AgentSummary {
  v: 1;
  verdict: Verdict;
  summary: string;
  pipeline: Record<PipelineNodeId, LayerStatus>;
  primary: Finding | null;
  others: { id: RuleId; severity: Severity; title: string }[];
  upstream: { issue: number; title: string; url: string; workaround: string | null }[];
  checks: { pass: number; fail: number; skip: number; pending: number };
  /** What to run next. */
  next: string;
}

export function nextStep(report: Report): string {
  const p = report.primaryFinding;
  switch (report.verdict) {
    case 'REPAIR_REQUIRED':
      if (p?.fix.patch || p?.fix.command?.writes) return 'experiment-doctor fix';
      return 'apply the fix by hand, then: experiment-doctor verify';
    case 'PENDING':
      return 'wait for more traffic, then: experiment-doctor verify';
    case 'HEALTHY':
      return 'none';
    case 'UNVERIFIABLE':
      if (!report.coverage.config) return 'collect Flagsmith evidence (flagsmith login, then experiment-doctor check)';
      if (!report.coverage.code) return 'scan the app: experiment-doctor check --dir <app>';
      return 'experiment-doctor canary --environment <test env> --allow-env <test env> (optional ingestion probe)';
  }
}

export function toAgentSummary(report: Report): AgentSummary {
  const count = (s: string) => report.checks.filter((c) => c.status === s).length;
  const pipeline = Object.fromEntries(report.pipeline.map((n) => [n.id, n.status])) as Record<PipelineNodeId, LayerStatus>;
  return {
    v: 1,
    verdict: report.verdict,
    summary: report.summary,
    pipeline,
    primary: report.primaryFinding,
    others: report.findings.slice(report.primaryFinding ? 1 : 0).map((f) => ({ id: f.id, severity: f.severity, title: f.title })),
    upstream: report.upstream.map((u) => ({ issue: u.issue, title: u.title, url: u.url, workaround: u.workaround })),
    checks: { pass: count('pass'), fail: count('fail'), skip: count('skip'), pending: count('pending') },
    next: nextStep(report),
  };
}
