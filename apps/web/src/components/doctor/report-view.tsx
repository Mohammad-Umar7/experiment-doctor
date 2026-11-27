"use client";

import { motion } from "motion/react";
import type { Finding, Report } from "@experiment-doctor/core";
import { Pipeline, type Stage, type StageStatus } from "@/components/pipeline";
import { StatusPill, type Status } from "@/components/ui/status-pill";
import { ease } from "@/lib/motion";
import { cn } from "@/lib/cn";

const VERDICT: Record<Report["verdict"], { tone: Status; label: string; line: string }> = {
  HEALTHY: { tone: "healthy", label: "Healthy", line: "Every check that could run passed." },
  REPAIR_REQUIRED: { tone: "critical", label: "Repair required", line: "The Doctor found something that stops this experiment from counting." },
  PENDING: { tone: "warning", label: "Pending", line: "Nothing is broken yet, the experiment is still collecting data." },
  UNVERIFIABLE: { tone: "unknown", label: "Unverifiable", line: "Not enough evidence to call it either way." },
};

const SEVERITY_TONE: Record<Finding["severity"], string> = {
  critical: "text-critical",
  warning: "text-warning",
  info: "text-info",
};

function nodeStatus(s: string): StageStatus {
  return s === "ok" ? "ok" : s === "broken" ? "broken" : "unknown";
}

export function ReportView({ report }: { report: Report }) {
  const verdict = VERDICT[report.verdict];
  const stages: Stage[] = report.pipeline.map((n) => ({
    key: n.id,
    label: n.label,
    status: nodeStatus(n.status),
    detail: n.findingIds.length ? n.findingIds.join(", ") : undefined,
  }));
  const primary = report.primaryFinding;
  const others = report.findings.filter((f) => f !== primary && f.id !== primary?.id);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: ease.smooth }}
      className="space-y-5"
    >
      <div className="rounded-[var(--radius-card)] border border-border bg-surface p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg-muted">
              {report.target.flag ?? "experiment"} · {new Date(report.generatedAt).toLocaleString()}
            </p>
            <p className="mt-2 text-[15px] text-fg">{report.summary || verdict.line}</p>
          </div>
          <StatusPill status={verdict.tone} pulse={report.verdict === "REPAIR_REQUIRED"}>
            {verdict.label}
          </StatusPill>
        </div>
        <div className="mt-5 border-t border-border pt-4">
          <Pipeline stages={stages} loop={false} />
        </div>
        <p className="mt-3 font-mono text-[11px] text-fg-muted">
          Checked: {report.coverage.config ? "Flagsmith config" : "no Flagsmith config"} · {report.coverage.code ? "code" : "no code"} ·{" "}
          {report.coverage.probe ? "canary probe" : "no canary probe"}. Gray stages were not verified.
        </p>
      </div>

      {primary && <FindingCard finding={primary} primary />}

      {report.upstream.length > 0 && (
        <div className="rounded-[var(--radius-card)] border border-warning/30 bg-warning/[0.05] p-5">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-warning">Possible upstream bug</p>
          <ul className="mt-3 space-y-3">
            {report.upstream.map((u) => (
              <li key={u.issue} className="text-[13.5px]">
                <a href={u.url} target="_blank" rel="noreferrer" className="text-fg underline-offset-4 hover:underline">
                  Flagsmith #{u.issue}: {u.title}
                </a>
                <p className="mt-1 text-fg-muted">{u.note}</p>
                {u.workaround && <p className="mt-1 text-fg-secondary">Workaround: {u.workaround}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {others.length > 0 && (
        <div className="space-y-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg-muted">Also found</p>
          {others.map((f) => (
            <FindingCard key={f.id} finding={f} />
          ))}
        </div>
      )}

      {report.checks.length > 0 && (
        <details className="group rounded-[var(--radius-card)] border border-border bg-surface">
          <summary className="cursor-pointer list-none px-5 py-4 text-[14px] text-fg-secondary hover:text-fg">
            All {report.checks.length} checks <span className="text-fg-muted group-open:hidden">· show</span>
          </summary>
          <ul className="divide-y divide-border border-t border-border">
            {report.checks.map((c) => (
              <li key={c.id} className="grid grid-cols-[64px_1fr_auto] gap-3 px-5 py-2.5 text-[13px]">
                <span className="font-mono text-fg-muted">{c.id}</span>
                <span className="text-fg-secondary">
                  {c.title}
                  {c.note && <span className="block text-[12px] text-fg-muted">{c.note}</span>}
                </span>
                <span
                  className={cn(
                    "font-mono text-[11px] uppercase tracking-[0.08em]",
                    c.status === "pass" ? "text-healthy" : c.status === "fail" ? "text-critical" : "text-fg-muted",
                  )}
                >
                  {c.status}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </motion.div>
  );
}

function FindingCard({ finding, primary = false }: { finding: Finding; primary?: boolean }) {
  const patch = finding.fix.patch;
  return (
    <div
      className={cn(
        "rounded-[var(--radius-card)] border bg-surface p-5 sm:p-6",
        primary ? "border-critical/30 shadow-[var(--shadow-critical)]" : "border-border",
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className={cn("font-mono text-[11px] uppercase tracking-[0.14em]", SEVERITY_TONE[finding.severity])}>
          {primary ? "Root cause" : finding.severity} · {finding.id} · {finding.layer}
        </p>
        <p className="font-mono text-[11px] text-fg-muted">confidence {Math.round(finding.confidence * 100)}%</p>
      </div>
      <h3 className={cn("mt-2 font-semibold tracking-[-0.01em]", primary ? "text-[20px]" : "text-[15px]")}>{finding.title}</h3>
      <p className="mt-1.5 text-[14px] leading-[1.6] text-fg-secondary">{finding.detail}</p>

      {finding.evidence.length > 0 && (
        <ul className="mt-4 space-y-1.5 rounded-[10px] border border-border bg-canvas/60 px-4 py-3 font-mono text-[12px]">
          {finding.evidence.map((e, i) => (
            <li key={i} className="text-fg-secondary">
              <span className="text-fg-muted">{e.source} · </span>
              {e.label}
              {e.value && <span className="text-fg"> {e.value}</span>}
              {e.location && (
                <span className="text-fg-muted">
                  {" "}
                  ({e.location.file}
                  {e.location.line ? `:${e.location.line}` : ""})
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4">
        <p className="text-[13.5px] text-fg">{finding.fix.summary}</p>
        {finding.fix.steps && finding.fix.steps.length > 0 && (
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-[13px] text-fg-secondary">
            {finding.fix.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        )}
        {patch && (
          <pre className="mt-3 overflow-x-auto rounded-[10px] border border-border bg-canvas px-4 py-3 font-mono text-[12.5px] leading-[1.7]">
            <span className="text-fg-muted">
              {patch.file}:{patch.line}
              {"\n"}
            </span>
            {patch.before.split("\n").map((l, i) => (
              <span key={`b${i}`} className="block text-critical">
                − {l}
              </span>
            ))}
            {patch.after.split("\n").map((l, i) => (
              <span key={`a${i}`} className="block text-healthy">
                + {l}
              </span>
            ))}
          </pre>
        )}
        {finding.fix.command && (
          <pre className="mt-3 overflow-x-auto rounded-[10px] border border-border bg-canvas px-4 py-3 font-mono text-[12.5px] text-fg">
            $ {finding.fix.command.command}
          </pre>
        )}
      </div>
    </div>
  );
}
