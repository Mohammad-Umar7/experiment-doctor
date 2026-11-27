"use client";

import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/cn";
import { ease } from "@/lib/motion";

export type StageStatus = "ok" | "broken" | "unknown" | "pending";

export type Stage = {
  key: string;
  label: string;
  status: StageStatus;
  detail?: string;
};

export const DEFAULT_STAGES: Stage[] = [
  { key: "app", label: "App", status: "ok" },
  { key: "sdk", label: "SDK", status: "ok" },
  { key: "flagsmith", label: "Flagsmith", status: "ok" },
  { key: "warehouse", label: "Warehouse", status: "ok" },
  { key: "results", label: "Results", status: "ok" },
];

const nodeTone: Record<StageStatus, string> = {
  ok: "border-healthy/40 text-healthy shadow-[var(--shadow-healthy)]",
  broken: "border-critical/60 text-critical shadow-[var(--shadow-critical)]",
  unknown: "border-dashed border-border-strong text-fg-muted",
  pending: "border-warning/40 text-warning",
};

const dotTone: Record<StageStatus, string> = {
  ok: "bg-healthy",
  broken: "bg-critical animate-critical-pulse",
  unknown: "bg-fg-muted",
  pending: "bg-warning animate-critical-pulse",
};

const statusWord: Record<StageStatus, string> = {
  ok: "verified",
  broken: "broken",
  unknown: "not verified",
  pending: "waiting",
};

/**
 * The experiment pipeline as a circuit. A signal travels left to right,
 * one connection every 280ms, and dies at the first broken stage.
 */
export function Pipeline({
  stages = DEFAULT_STAGES,
  className,
  compact = false,
  loop = true,
}: {
  stages?: Stage[];
  className?: string;
  compact?: boolean;
  loop?: boolean;
}) {
  const reduce = useReducedMotion();
  const brokenIndex = stages.findIndex((s) => s.status === "broken" || s.status === "unknown" || s.status === "pending");
  const reach = brokenIndex === -1 ? stages.length - 1 : brokenIndex;
  const hop = 0.28;
  const total = reach * hop;

  return (
    <ol className={cn("flex w-full items-center", className)} aria-label="Experiment pipeline">
      {stages.map((stage, i) => (
        <li key={stage.key} className={cn("flex items-center", i < stages.length - 1 && "flex-1")}>
          <div className="flex flex-col items-center gap-1.5">
            <motion.div
              layout
              className={cn(
                "flex items-center gap-1.5 rounded-[8px] border bg-surface font-mono font-medium uppercase transition-[border-color,color,box-shadow] duration-300",
                compact ? "gap-1 px-1.5 py-1 text-[9px] tracking-[0.04em]" : "px-2.5 py-1.5 text-[10px] tracking-[0.1em] sm:text-[11px]",
                nodeTone[stage.status],
              )}
              title={stage.detail ?? `${stage.label}: ${statusWord[stage.status]}`}
            >
              <span className={cn("shrink-0 rounded-full", compact ? "h-1 w-1" : "h-1.5 w-1.5", dotTone[stage.status])} aria-hidden />
              {stage.label}
            </motion.div>
            <span className="sr-only">{`${stage.label}: ${statusWord[stage.status]}`}</span>
          </div>

          {i < stages.length - 1 && (
            <div className={cn("relative h-px min-w-[6px] flex-1 overflow-hidden bg-border", compact ? "mx-0.5" : "mx-1 sm:mx-2")}>
              <div
                className={cn(
                  "absolute inset-0 transition-colors duration-500",
                  i < reach ? "bg-healthy/35" : "bg-transparent",
                )}
              />
              {!reduce && i < reach && (
                <motion.span
                  className="absolute top-1/2 h-[3px] w-6 -translate-y-1/2 rounded-full bg-healthy shadow-[0_0_10px_#22FF88]"
                  initial={{ left: "-24px", opacity: 0 }}
                  animate={{ left: ["-24px", "100%"], opacity: [0, 1, 1, 0] }}
                  transition={{
                    duration: hop,
                    ease: ease.standard,
                    delay: i * hop,
                    repeat: loop ? Infinity : 0,
                    repeatDelay: Math.max(0.6, 1.6 - hop + total - hop),
                  }}
                />
              )}
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}
