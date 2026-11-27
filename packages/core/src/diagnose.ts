import { TOOL_NAME, TOOL_VERSION } from './constants';
import { buildLayers, buildPipeline } from './pipeline';
import { matchKnownBugs } from './registry/known-bugs';
import { ALL_RULES } from './rules';
import { buildContext } from './rules/context';
import type { Rule, RuleOutcome } from './rules/types';
import type { CheckResult, Evidence, Finding, PipelineNode, Report, Severity, Verdict } from './types';

export interface DiagnoseOptions {
  rules?: Rule[];
  /** ISO timestamp for generatedAt when the evidence has no collectedAt. */
  now?: string;
}

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

/** Defects before pending items, then severity, then rule priority, then confidence. */
export function compareFindings(rank: (id: string) => number) {
  return (a: Finding, b: Finding): number =>
    (a.kind === b.kind ? 0 : a.kind === 'defect' ? -1 : 1) ||
    SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
    rank(a.id) - rank(b.id) ||
    b.confidence - a.confidence;
}

export function diagnose(evidence: Evidence, options: DiagnoseOptions = {}): Report {
  const rules = options.rules ?? ALL_RULES;
  const ctx = buildContext(evidence);
  const checks: CheckResult[] = [];
  const findings: Finding[] = [];

  for (const rule of rules) {
    let out: RuleOutcome;
    try {
      out = rule.run(ctx);
    } catch (err) {
      out = { status: 'skip', note: `Check could not run: ${err instanceof Error ? err.message : String(err)}` };
    }
    const check: CheckResult = { id: rule.id, title: rule.title, layer: rule.layer, node: rule.node, status: out.status };
    if (out.note) check.note = out.note;
    checks.push(check);
    findings.push(...(out.findings ?? []));
  }

  const rankOf = new Map(rules.map((r) => [r.id as string, r.rank]));
  findings.sort(compareFindings((id) => rankOf.get(id) ?? 999));

  const pipeline = buildPipeline(checks, findings, rules);
  const layers = buildLayers(checks, findings, rules);
  const verdict = verdictOf(findings, checks, pipeline);
  const primaryFinding = findings[0] ?? null;
  const exp = evidence.config?.experiment ?? undefined;

  const target: Report['target'] = {};
  if (ctx.flagKey) target.flag = ctx.flagKey;
  const expId = exp?.id ?? evidence.target?.experimentId;
  if (expId !== undefined) target.experimentId = expId;
  if (exp?.name) target.experimentName = exp.name;
  if (evidence.config?.environment?.name) target.environment = evidence.config.environment.name;
  if (ctx.app) {
    target.app = ctx.app.path || '.';
    if (ctx.app.otherApps.length) target.otherApps = ctx.app.otherApps.map((a) => a || '.');
  }

  return {
    schemaVersion: 1,
    tool: { name: TOOL_NAME, version: TOOL_VERSION },
    generatedAt: evidence.collectedAt ?? options.now ?? new Date().toISOString(),
    verdict,
    summary: summarize(verdict, findings, pipeline, checks),
    target,
    layers,
    pipeline,
    findings,
    primaryFinding,
    checks,
    upstream: matchKnownBugs(evidence, findings),
    coverage: { config: !!evidence.config, code: !!evidence.code, probe: !!evidence.probe },
  };
}

export function verdictOf(findings: Finding[], checks: CheckResult[], pipeline: PipelineNode[]): Verdict {
  if (findings.some((f) => f.kind === 'defect' && f.severity !== 'info')) return 'REPAIR_REQUIRED';
  if (findings.some((f) => f.kind === 'pending') || checks.some((c) => c.status === 'pending')) return 'PENDING';
  if (pipeline.every((n) => n.status === 'ok')) return 'HEALTHY';
  return 'UNVERIFIABLE';
}

function summarize(verdict: Verdict, findings: Finding[], pipeline: PipelineNode[], checks: CheckResult[]): string {
  const primary = findings[0];
  switch (verdict) {
    case 'REPAIR_REQUIRED': {
      const others = findings.filter((f) => f !== primary && f.kind === 'defect' && f.severity !== 'info').length;
      return `Repair required: ${primary!.title}.${others ? ` ${others} more issue${others === 1 ? '' : 's'} after that.` : ''}`;
    }
    case 'PENDING':
      return `No defect found; waiting for data: ${primary ? primary.title.replace(/^./, (c) => c.toLowerCase()) : 'results are not ready'}.`;
    case 'HEALTHY':
      return 'Healthy: every required check passed and the results show enough exposures and conversions in every variation.';
    case 'UNVERIFIABLE': {
      const unknown = pipeline.filter((n) => n.status === 'unknown').map((n) => n.label);
      const skipped = checks.filter((c) => c.status === 'skip').length;
      return `No defect found in what was checked, but ${unknown.join(', ')} could not be verified (${skipped} check${skipped === 1 ? '' : 's'} lacked evidence).`;
    }
  }
}
