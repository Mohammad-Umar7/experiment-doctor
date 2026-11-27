"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Ecg } from "@/components/ecg";
import { Pipeline, type Stage } from "@/components/pipeline";
import { Counter } from "@/components/counter";
import { StatusPill } from "@/components/ui/status-pill";
import { useResurrection } from "@/lib/use-resurrection";
import { ease } from "@/lib/motion";
import { cn } from "@/lib/cn";

type Phase = "flatline" | "scanning" | "found" | "revived";

const PHASE_MS: Record<Phase, number> = {
  flatline: 3200,
  scanning: 2600,
  found: 2600,
  revived: 5200,
};

const NEXT: Record<Phase, Phase> = {
  flatline: "scanning",
  scanning: "found",
  found: "revived",
  revived: "flatline",
};

const SCAN_LINES = [
  "flagsmith api experiments/ --json",
  "variant keys ......... ok",
  "identify before flag .. ok",
  "events flushed ........ ok",
  "metric event name ..... MISMATCH",
];

function stagesFor(phase: Phase, scanned: number, fixed: boolean): Stage[] {
  const base: Stage[] = [
    { key: "app", label: "App", status: "ok" },
    { key: "sdk", label: "SDK", status: "ok" },
    { key: "flagsmith", label: "Flagsmith", status: "broken", detail: "event 'Purchase' matches no metric" },
    { key: "warehouse", label: "Warehouse", status: "unknown" },
    { key: "results", label: "Results", status: "unknown" },
  ];
  if (fixed) return base.map((s) => ({ ...s, status: "ok" }));
  if (phase === "scanning") {
    return base.map((s, i) => ({ ...s, status: i < scanned ? (s.status === "broken" ? "broken" : "ok") : "unknown" }));
  }
  return base;
}

/**
 * Landing page vitals monitor. Plays a simulated case on a loop:
 * flatline, Doctor scans, root cause found, verified repair, heartbeat returns.
 */
export function VitalsMonitor({ className }: { className?: string }) {
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState<Phase>("flatline");
  const [scanned, setScanned] = useState(0);
  const [exposures, setExposures] = useState(248);
  const revived = phase === "revived";
  const step = useResurrection(revived);

  // Phase loop
  useEffect(() => {
    const t = setTimeout(() => setPhase((p) => NEXT[p]), PHASE_MS[phase]);
    return () => clearTimeout(t);
  }, [phase]);

  // Scan progress while scanning
  useEffect(() => {
    if (phase !== "scanning") {
      setScanned(phase === "flatline" ? 0 : 5);
      return;
    }
    setScanned(0);
    const iv = setInterval(() => setScanned((n) => Math.min(5, n + 1)), 480);
    return () => clearInterval(iv);
  }, [phase]);

  // Exposures keep arriving: the experiment is live, only conversions are missing.
  useEffect(() => {
    const iv = setInterval(() => setExposures((n) => (n > 400 ? 248 : n + 1 + Math.floor(Math.random() * 3))), 900);
    return () => clearInterval(iv);
  }, []);

  const conversions = step.heartbeat ? 12 : 0;
  const status =
    phase === "flatline"
      ? { tone: "critical" as const, text: "Critical", pulse: true }
      : phase === "scanning"
        ? { tone: "accent" as const, text: "Diagnosing", pulse: true }
        : phase === "found"
          ? { tone: "warning" as const, text: "Repair ready", pulse: false }
          : { tone: "healthy" as const, text: "Healthy", pulse: false };

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[var(--radius-monitor)] border border-border bg-surface shadow-[var(--shadow-card)]",
        className,
      )}
    >
      <div className="bg-grid pointer-events-none absolute inset-0 opacity-40 [mask-image:linear-gradient(to_bottom,black,transparent)]" />

      {/* header */}
      <div className="relative flex items-center justify-between border-b border-border px-4 py-3 sm:px-5">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg-muted">
          Experiment <span className="text-fg-secondary">/ checkout_v2</span>
        </p>
        <StatusPill status={status.tone} pulse={status.pulse}>
          {status.text}
        </StatusPill>
      </div>

      {/* vitals */}
      <div className="relative grid grid-cols-3 divide-x divide-border border-b border-border">
        <Vital label="Exposures">
          <Counter value={exposures} className="text-fg" />
        </Vital>
        <Vital label="Conversions">
          <Counter value={conversions} pad={3} className={step.heartbeat ? "text-healthy" : "text-critical"} />
        </Vital>
        <Vital label="Diagnosis">
          <span className={cn("text-[15px] sm:text-lg", revived ? "text-healthy" : phase === "found" ? "text-warning" : "text-fg-secondary")}>
            {phase === "flatline" ? "Waiting" : phase === "scanning" ? "Scanning" : phase === "found" ? "ED-004" : "Verified"}
          </span>
        </Vital>
      </div>

      {/* trace */}
      <div className="relative px-2 pt-4 sm:px-4">
        <Ecg alive={step.heartbeat} className="h-auto w-full" width={720} height={130} />
        <AnimatePresence>
          {step.banner && (
            <motion.p
              key="revived"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, ease: ease.smooth }}
              className="absolute right-4 top-4 font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-healthy sm:right-6"
            >
              Experiment revived
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      {/* doctor console */}
      <div className="relative mx-4 mb-4 mt-2 h-[92px] overflow-hidden rounded-[10px] border border-border bg-canvas/70 px-3 py-2.5 font-mono text-[11.5px] leading-[1.6] sm:mx-5 sm:text-xs">
        <AnimatePresence mode="wait">
          {phase === "flatline" && (
            <ConsoleBlock key="flat">
              <p className="text-fg-muted">$ npx experiment-doctor check</p>
              <p className="text-critical">{exposures} exposures, 0 conversions. Something is broken.</p>
            </ConsoleBlock>
          )}
          {phase === "scanning" && (
            <ConsoleBlock key="scan">
              {SCAN_LINES.slice(0, Math.max(1, scanned)).map((line) => (
                <p key={line} className={line.includes("MISMATCH") ? "text-critical" : "text-fg-secondary"}>
                  {line}
                </p>
              ))}
            </ConsoleBlock>
          )}
          {phase === "found" && (
            <ConsoleBlock key="found">
              <p className="text-warning">ED-004 metric event name mismatch · checkout.ts:4</p>
              <p className="text-critical">- flagsmith.trackEvent(&quot;Purchase&quot;)</p>
              <p className="text-healthy">+ flagsmith.trackEvent(&quot;purchase&quot;)</p>
            </ConsoleBlock>
          )}
          {phase === "revived" && (
            <ConsoleBlock key="ok">
              <p className="text-fg-muted">$ npx experiment-doctor verify</p>
              <p className="text-healthy">VERIFIED · exposure and conversion joined for the same identity</p>
              <p className="text-fg-secondary">conversions arriving: 12 and counting</p>
            </ConsoleBlock>
          )}
        </AnimatePresence>
      </div>

      {/* pipeline */}
      <div className="relative border-t border-border px-3 py-4 sm:px-5">
        <Pipeline stages={stagesFor(phase, scanned, step.nodeFixed)} compact loop={!reduce} />
      </div>
    </div>
  );
}

function Vital({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-4 py-3 sm:px-5 sm:py-4">
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-muted sm:text-[11px]">{label}</p>
      <p className="mt-1 font-mono text-2xl font-medium leading-none sm:text-[28px]">{children}</p>
    </div>
  );
}

function ConsoleBlock({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.2, ease: ease.smooth }}
    >
      {children}
    </motion.div>
  );
}
