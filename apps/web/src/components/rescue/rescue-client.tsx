"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Counter } from "@/components/counter";
import { Eyebrow, Panel } from "@/components/ui/panel";
import { StatusPill } from "@/components/ui/status-pill";
import type { ExperimentResults } from "@/lib/experiment-results";
import { CASES } from "@/lib/game/cases";
import type { GameStats } from "@/lib/game/types";
import { formatMs } from "@/lib/game/time";
import { ease } from "@/lib/motion";
import { HINT_VARIANTS, type HintVariant } from "@/lib/site";
import { cn } from "@/lib/cn";

const VARIANTS: Array<{ key: HintVariant; flagsmithKey: string; letter: string; label: string }> = [
  { key: HINT_VARIANTS.control, flagsmithKey: "control", letter: "A", label: "Full diagnostic report" },
  { key: HINT_VARIANTS.challenger, flagsmithKey: "one_fix", letter: "B", label: "One prioritized fix" },
];

const CHECK_LABEL: Record<string, string> = {
  parse: "Code does not parse",
  events: "Events not enabled",
  identify: "Flag read before identify()",
  exposure: "No exposure recorded",
  metric: "Event name does not match the metric",
  identity: "Conversion under another identity",
  flush: "Events not flushed before leaving",
};

const MIN_IDENTITIES = 50;
const MIN_CONVERSIONS = 5;

type Stats = GameStats & { storage: string };

function pct(v: number | null | undefined, digits = 0) {
  return v === null || v === undefined || Number.isNaN(v) ? "—" : `${(v * 100).toFixed(digits)}%`;
}

function ago(iso: string | null, now: number) {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}

export function RescueClient() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [results, setResults] = useState<ExperimentResults | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let alive = true;
    async function load() {
      const [s, r] = await Promise.all([
        fetch("/api/stats", { cache: "no-store" }).then((x) => (x.ok ? x.json() : null)).catch(() => null),
        fetch("/api/experiment", { cache: "no-store" }).then((x) => (x.ok ? x.json() : null)).catch(() => null),
      ]);
      if (!alive) return;
      if (s) setStats(s);
      if (r) setResults(r);
    }
    void load();
    const iv = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 15_000);
    const clock = setInterval(() => setNow(Date.now()), 5_000);
    return () => {
      alive = false;
      clearInterval(iv);
      clearInterval(clock);
    };
  }, []);

  const repairRate = stats && stats.players > 0 ? stats.verifiedRepairs / stats.players : null;
  const allTimes = stats ? Object.values(stats.byVariant).map((v) => v.medianMs).filter((v): v is number => v !== null) : [];
  const failing = stats ? Object.entries(stats.failingChecks).sort((a, b) => b[1] - a[1]) : [];
  const failingMax = failing[0]?.[1] ?? 1;
  const fsByKey = new Map((results?.variants ?? []).map((v) => [v.key, v]));

  return (
    <div className="mx-auto w-full max-w-[1280px] px-4 pb-20 pt-10 sm:px-6 sm:pt-14">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Eyebrow>Rescue Center</Eyebrow>
          <h1 className="mt-2 text-[32px] font-semibold tracking-[-0.03em] sm:text-[40px]">How the experiment is going.</h1>
          <p className="mt-3 max-w-[640px] text-[15px] leading-[1.6] text-fg-secondary">
            Human vs Doctor is a live Flagsmith experiment. Here are the numbers from our server, the result Flagsmith
            computes, and the Doctor checking our own experiment for problems.
          </p>
        </div>
        <StatusPill status="healthy" pulse>
          Live · {stats ? ago(stats.updatedAt, now) : "loading"}
        </StatusPill>
      </div>

      {/* KPIs */}
      <div className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-card)] border border-border bg-border lg:grid-cols-4">
        <Kpi label="Players" hint="first counted run each">
          <Counter value={stats?.players ?? 0} />
        </Kpi>
        <Kpi label="Verified repairs" hint="inside 3 minutes">
          <Counter value={stats?.verifiedRepairs ?? 0} className="text-healthy" />
        </Kpi>
        <Kpi label="Repair rate" hint="all players">
          {pct(repairRate)}
        </Kpi>
        <Kpi label="Fastest median" hint="by hint style">
          {allTimes.length ? formatMs(Math.min(...allTimes)) : "—"}
        </Kpi>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        {/* A/B */}
        <Panel className="p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Which hint gets more people to a verified repair?</h2>
              <p className="mt-1 font-mono text-[11px] text-fg-muted">flag doctor_hint_style · metric verified_repair · 50/50</p>
            </div>
            <StatusPill status={results?.treatment ? "accent" : "unknown"}>
              {results?.treatment ? "Flagsmith result" : "Collecting data"}
            </StatusPill>
          </div>

          <div className="mt-6 space-y-5">
            {VARIANTS.map((v) => {
              const s = stats?.byVariant[v.key];
              const rate = s && s.enrolled > 0 ? s.repaired / s.enrolled : 0;
              return (
                <div key={v.key}>
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-[14px] text-fg">
                      <span className="mr-2 font-mono text-fg-muted">{v.letter}</span>
                      {v.label}
                    </p>
                    <p className="font-mono text-[13px] text-fg-secondary">
                      <span className="text-[18px] text-fg">{pct(s && s.enrolled ? rate : null)}</span>{" "}
                      <span className="text-fg-muted">
                        {s?.repaired ?? 0}/{s?.enrolled ?? 0}
                      </span>
                    </p>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-elevated">
                    <motion.div
                      className={cn("h-full rounded-full", v.letter === "A" ? "bg-fg-secondary" : "bg-accent")}
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.round(rate * 100)}%` }}
                      transition={{ duration: 0.6, ease: ease.smooth }}
                    />
                  </div>
                  <p className="mt-1.5 font-mono text-[11px] text-fg-muted">
                    hint opened by {s?.hinted ?? 0} · median repair {s?.medianMs ? formatMs(s.medianMs) : "—"}
                  </p>
                </div>
              );
            })}
          </div>

          <div className="mt-6 rounded-[10px] border border-border bg-canvas/60 p-4">
            {results?.treatment ? (
              <div className="grid gap-4 sm:grid-cols-3">
                <Fact label="Chance B beats A" value={pct(results.treatment.chanceToWin, 1)} strong />
                <Fact label="Lift" value={`${results.treatment.lift >= 0 ? "+" : ""}${pct(results.treatment.lift, 1)}`} />
                <Fact label="95% credible interval" value={`${pct(results.treatment.ciLow, 0)} to ${pct(results.treatment.ciHigh, 0)}`} />
              </div>
            ) : (
              <div>
                <p className="text-[13px] text-fg-secondary">
                  Flagsmith publishes a win probability once every variation has {MIN_IDENTITIES} identities and{" "}
                  {MIN_CONVERSIONS} conversions. Progress toward that bar:
                </p>
                <div className="mt-3 space-y-2">
                  {VARIANTS.map((v) => {
                    const fs = fsByKey.get(v.flagsmithKey);
                    const n = fs?.exposed ?? 0;
                    const c = fs?.converted ?? 0;
                    return (
                      <div key={v.key} className="grid grid-cols-[20px_1fr_auto] items-center gap-3 font-mono text-[11.5px]">
                        <span className="text-fg-muted">{v.letter}</span>
                        <div className="h-1.5 overflow-hidden rounded-full bg-elevated">
                          <div className="h-full rounded-full bg-info" style={{ width: `${Math.min(100, (n / MIN_IDENTITIES) * 100)}%` }} />
                        </div>
                        <span className="text-fg-secondary">
                          {n}/{MIN_IDENTITIES} exposed · {c}/{MIN_CONVERSIONS} converted
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            <p className="mt-3 font-mono text-[10.5px] text-fg-muted">
              {results?.source === "live" ? "Live from the Flagsmith API" : results?.source === "snapshot" ? "Flagsmith snapshot" : "No Flagsmith data yet"}
              {results?.asOf ? ` · computed ${ago(results.asOf, now)}` : ""} · bars above are our own server counts
            </p>
          </div>
        </Panel>

        {/* Doctor on our own experiment + where people get stuck */}
        <div className="space-y-6">
          <Panel className="p-6">
            <h2 className="text-base font-semibold">The Doctor, checking our own experiment</h2>
            <ul className="mt-4 space-y-3 text-[13px]">
              <HealthRow
                ok={(results?.variants.length ?? 0) > 0}
                pending={!results || results.variants.length === 0}
                label="Exposures reaching Flagsmith"
                detail={
                  results && results.variants.length
                    ? results.variants.map((v) => `${v.key}: ${v.exposed}`).join(" · ")
                    : "No Flagsmith counts in this snapshot yet."
                }
              />
              <HealthRow
                ok={results?.srmPValue === null || results?.srmPValue === undefined ? false : results.srmPValue > 0.01}
                pending={results?.srmPValue === null || results?.srmPValue === undefined}
                label="Traffic split matches 50/50 (sample ratio check)"
                detail={
                  results?.srmPValue === null || results?.srmPValue === undefined
                    ? "Flagsmith runs this test once there is enough traffic."
                    : `p = ${results.srmPValue.toFixed(3)}${results.srmPValue <= 0.01 ? ", investigate the split" : ""}`
                }
              />
              <HealthRow
                ok
                label="Exposure recorded only when a counted run starts"
                detail="getExperimentFlag runs on Start, never for practice runs."
              />
              <HealthRow ok label="Conversion name matches the metric" detail="trackEvent('verified_repair') = metric event verified_repair" />
            </ul>
          </Panel>

          <Panel className="p-6">
            <h2 className="text-base font-semibold">Where players get stuck</h2>
            {failing.length === 0 ? (
              <p className="mt-3 text-[13px] text-fg-muted">No failed verifications recorded yet.</p>
            ) : (
              <ul className="mt-4 space-y-3">
                {failing.map(([id, count]) => (
                  <li key={id}>
                    <div className="flex justify-between text-[13px]">
                      <span className="text-fg-secondary">{CHECK_LABEL[id] ?? id}</span>
                      <span className="font-mono text-fg">{count}</span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-elevated">
                      <div className="h-full rounded-full bg-critical/70" style={{ width: `${(count / failingMax) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-6 border-t border-border pt-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-muted">Repair rate by case</p>
              <ul className="mt-3 space-y-1.5 font-mono text-[12px]">
                {CASES.map((c) => {
                  const s = stats?.byCase[c.id];
                  return (
                    <li key={c.id} className="flex justify-between gap-3">
                      <span className="truncate text-fg-secondary">
                        {c.id} {c.title}
                      </span>
                      <span className="text-fg">{s ? `${s.repaired}/${s.started}` : "0/0"}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface px-5 py-5">
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-muted">{label}</p>
      <p className="mt-2 font-mono text-[30px] font-medium leading-none tabular text-fg">{children}</p>
      <p className="mt-2 text-[12px] text-fg-muted">{hint}</p>
    </div>
  );
}

function Fact({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-muted">{label}</p>
      <p className={cn("mt-1 font-mono tabular", strong ? "text-[26px] text-healthy" : "text-[18px] text-fg")}>{value}</p>
    </div>
  );
}

function HealthRow({ ok, pending = false, label, detail }: { ok: boolean; pending?: boolean; label: string; detail: string }) {
  const tone = pending ? "text-fg-muted" : ok ? "text-healthy" : "text-critical";
  return (
    <li className="flex gap-3">
      <span className={cn("mt-0.5 font-mono", tone)} aria-hidden>
        {pending ? "○" : ok ? "✓" : "✕"}
      </span>
      <div>
        <p className="text-fg">
          {label}
          <span className="sr-only">{pending ? ": not verified yet" : ok ? ": passing" : ": failing"}</span>
        </p>
        <p className="mt-0.5 text-[12px] text-fg-muted">{detail}</p>
      </div>
    </li>
  );
}
