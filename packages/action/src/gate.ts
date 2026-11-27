/**
 * Experiment Doctor CI Gate: the pure part.
 *
 * Given the Doctor's reports for the base and head of a pull request, decide which findings
 * the pull request introduced, which it fixed, and whether it renamed a conversion event that
 * a metric still depends on. Only new, high-confidence defects fail the check; pending
 * experiment data never does.
 */
import type { CodeEvidence, Finding, Report, Severity } from "@experiment-doctor/core";

export type GateConfig = {
  /** Metric event names the experiment depends on (from .experiment-doctor.json). */
  metrics: string[];
  /** Fail when a new defect has this severity or worse. */
  failOn: Severity;
  /** Ignore new defects below this confidence. */
  minConfidence: number;
};

export type Annotation = {
  level: "error" | "warning" | "notice";
  file: string;
  line: number;
  title: string;
  message: string;
};

export type Rename = { from: string; to: string; file: string; line: number; breaksMetric: boolean };

export type GateResult = {
  introduced: Finding[];
  fixed: Finding[];
  unchanged: Finding[];
  renames: Rename[];
  failing: boolean;
  annotations: Annotation[];
};

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

function primaryLocation(f: Finding): { file: string; line: number; text: string } | null {
  for (const e of f.evidence) {
    if (e.location) {
      return {
        file: e.location.file,
        line: e.location.line,
        text: (e.location.text ?? e.location.snippet ?? "").replace(/\s+/g, " ").trim(),
      };
    }
  }
  if (f.fix.patch) return { file: f.fix.patch.file, line: f.fix.patch.line, text: f.fix.patch.before.replace(/\s+/g, " ").trim() };
  return null;
}

/** Stable identity of a finding across commits: rule + file + offending text, not the line number. */
export function findingKey(f: Finding): string {
  const loc = primaryLocation(f);
  return loc ? `${f.id}|${loc.file}|${loc.text}` : `${f.id}|-`;
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

/** Conversion events that existed at base, vanished at head, and reappeared under a near-identical name. */
export function findRenames(base: CodeEvidence | null, head: CodeEvidence | null, metrics: string[]): Rename[] {
  if (!base || !head) return [];
  const baseNames = new Set(base.trackEvents.map((t) => t.event).filter((e): e is string => Boolean(e)));
  const headNames = new Set(head.trackEvents.map((t) => t.event).filter((e): e is string => Boolean(e)));
  const renames: Rename[] = [];
  for (const gone of baseNames) {
    if (headNames.has(gone)) continue;
    for (const t of head.trackEvents) {
      if (!t.event || baseNames.has(t.event)) continue;
      const close = t.event.toLowerCase() === gone.toLowerCase() || editDistance(t.event, gone) <= 2;
      if (close) {
        renames.push({
          from: gone,
          to: t.event,
          file: t.loc.file,
          line: t.loc.line,
          breaksMetric: metrics.includes(gone) && !metrics.includes(t.event),
        });
      }
    }
  }
  return renames;
}

export function runGate(
  base: Report | null,
  head: Report,
  code: { base: CodeEvidence | null; head: CodeEvidence | null },
  config: GateConfig,
): GateResult {
  const baseKeys = new Set((base?.findings ?? []).map(findingKey));
  const headKeys = new Set(head.findings.map(findingKey));

  const defects = head.findings.filter((f) => f.kind === "defect");
  const introduced = defects.filter((f) => !baseKeys.has(findingKey(f)));
  const unchanged = defects.filter((f) => baseKeys.has(findingKey(f)));
  const fixed = (base?.findings ?? []).filter((f) => f.kind === "defect" && !headKeys.has(findingKey(f)));
  const renames = findRenames(code.base, code.head, config.metrics);

  const blocking = (f: Finding) => SEVERITY_RANK[f.severity] <= SEVERITY_RANK[config.failOn] && f.confidence >= config.minConfidence;
  const failing = introduced.some(blocking) || renames.some((r) => r.breaksMetric);

  const annotations: Annotation[] = [];
  for (const r of renames) {
    annotations.push({
      level: r.breaksMetric ? "error" : "warning",
      file: r.file,
      line: r.line,
      title: r.breaksMetric ? "Experiment regression: conversion event renamed" : "Conversion event renamed",
      message: r.breaksMetric
        ? `trackEvent("${r.from}") became trackEvent("${r.to}"), but the metric still listens for "${r.from}". Conversions will silently stop counting.`
        : `trackEvent("${r.from}") became trackEvent("${r.to}"). Check that a metric listens for the new name.`,
    });
  }
  for (const f of introduced) {
    const loc = primaryLocation(f);
    if (!loc) continue;
    annotations.push({
      level: blocking(f) ? "error" : "warning",
      file: loc.file,
      line: loc.line,
      title: `${f.id} ${f.title}`.slice(0, 120),
      message: `${f.detail} Fix: ${f.fix.summary}`,
    });
  }

  return { introduced, fixed, unchanged, renames, failing, annotations };
}

export function summaryMarkdown(result: GateResult, head: Report): string {
  const lines: string[] = [];
  lines.push(`## Experiment Doctor CI Gate: ${result.failing ? "❌ blocked" : "✅ passed"}`);
  lines.push("");
  lines.push(
    result.failing
      ? "This pull request introduces a change that would make the experiment stop counting. Nothing else in the build would catch it: SDKs skip events silently."
      : "No new experiment regressions in this pull request.",
  );
  lines.push("");
  if (result.renames.length) {
    lines.push("### Renamed conversion events");
    lines.push("| From | To | Where | Breaks a metric |");
    lines.push("| --- | --- | --- | --- |");
    for (const r of result.renames) lines.push(`| \`${r.from}\` | \`${r.to}\` | ${r.file}:${r.line} | ${r.breaksMetric ? "yes" : "no"} |`);
    lines.push("");
  }
  const table = (title: string, findings: Finding[]) => {
    if (!findings.length) return;
    lines.push(`### ${title}`);
    lines.push("| Rule | Finding | Where | Confidence |");
    lines.push("| --- | --- | --- | --- |");
    for (const f of findings) {
      const loc = primaryLocation(f);
      lines.push(`| ${f.id} | ${f.title} | ${loc ? `${loc.file}:${loc.line}` : "config"} | ${Math.round(f.confidence * 100)}% |`);
    }
    lines.push("");
  };
  table("Introduced by this PR", result.introduced);
  table("Fixed by this PR", result.fixed);
  if (result.unchanged.length) lines.push(`${result.unchanged.length} existing finding(s) unchanged, not blocking.`, "");
  lines.push(`Head verdict: **${head.verdict}**. Pending experiment data never fails this check.`);
  return lines.join("\n");
}
