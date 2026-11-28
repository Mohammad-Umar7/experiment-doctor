"use client";

import { useEffect, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { Counter } from "@/components/counter";
import { ButtonLink } from "@/components/ui/button";
import { Eyebrow, Panel } from "@/components/ui/panel";
import { Timeline, VARIANT_COLOR } from "@/components/rescue/timeline";
import { StatusPill } from "@/components/ui/status-pill";
import type { ExperimentResults } from "@/lib/experiment-results";
import { CASES } from "@/lib/game/cases";
import type { GameStats } from "@/lib/game/types";
import { formatMs } from "@/lib/game/time";
import { ease } from "@/lib/motion";
import { EXPERIMENT_EVENT, EXPERIMENT_FLAG, HINT_VARIANTS, type HintVariant } from "@/lib/site";
import { cn } from "@/lib/cn";

type VariantInfo = {
  key: HintVariant;
  flagsmithKey: string;
  letter: string;
  label: string;
  blurb: string;
  preview: ReactNode;
};

/** Case 001's real hints, so the preview shows exactly what a player in each arm gets. */
const SAMPLE = CASES[0];
const SAMPLE_REPORT = [...SAMPLE.fullReport.filter((c) => c.ok).slice(0, 2), ...SAMPLE.fullReport.filter((c) => !c.ok)];

const VARIANTS: VariantInfo[] = [
  {
    key: HINT_VARIANTS.control,
    flagsmithKey: "control",
    letter: "A",
    label: "Full diagnostic report",
    blurb: "Every check the Doctor ran, with the failing one explained.",
    preview: (
      <>
        {SAMPLE_REPORT.map((c) => (
          <span key={c.label} className={cn("block truncate", !c.ok && "text-fg")}>
            <span className={c.ok ? "text-healthy" : "text-critical"}>{c.ok ? "✓" : "✕"}</span> {c.label}
          </span>
        ))}
      </>
    ),
  },
  {
    key: HINT_VARIANTS.challenger,
    flagsmithKey: "one_fix",
    letter: "B",
    label: "One prioritized fix",
    blurb: "Only the most likely repair, shown as a diff.",
    preview: (
      <>
        <span className="block truncate text-fg-secondary">{SAMPLE.oneFix.instruction}</span>
        <span className="block truncate text-critical">− {SAMPLE.oneFix.before}</span>
        <span className="block truncate text-healthy">+ {SAMPLE.oneFix.after}</span>
      </>
    ),
  },
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

/** Flagsmith publishes inference once every variation reaches both numbers. */
const MIN_IDENTITIES = 50;
const MIN_CONVERSIONS = 5;

type Stats = GameStats & { storage: string };

function pct(v: number | null | undefined, digits = 0) {
  return v === null || v === undefined || Number.isNaN(v) ? "—" : `${(v * 100).toFixed(digits)}%`;
}

function ago(iso: string | null, now: number) {
  if (!iso) return "never";
  if (!now) return "just now";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}

export function RescueClient() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [results, setResults] = useState<ExperimentResults | null>(null);
  // Set on mount: reading the clock during prerender would freeze it into the static shell.
  const [now, setNow] = useState(0);

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
    setNow(Date.now());
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

  const fsByKey = new Map((results?.variants ?? []).map((v) => [v.key, v]));
  const failing = stats ? Object.entries(stats.failingChecks).sort((a, b) => b[1] - a[1]) : [];
  const failingMax = failing[0]?.[1] ?? 1;
  const hasPlayers = (stats?.sessions ?? 0) > 0;
  const hasTimeline = (results?.timeline.length ?? 0) > 0;

  return (
    <div className="mx-auto w-full max-w-[1280px] px-4 pb-20 pt-10 sm:px-6 sm:pt-14">
      {/* header */}
      <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="max-w-[720px]">
          <Eyebrow>Rescue Center · live A/B test</Eyebrow>
          <h1 className="mt-2 text-balance text-[32px] font-semibold leading-[1.08] tracking-[-0.03em] sm:text-[40px]">
            Which hint helps players fix the bug?
          </h1>
          <p className="mt-3 text-[15px] leading-[1.6] text-fg-secondary">
            Our game is a real Flagsmith experiment. Every player who starts a counted run gets one of two hint styles at
            random, and Flagsmith measures which one gets more people to a verified repair.
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 md:items-end">
          <StatusPill status="healthy" pulse>
            Live · {stats ? ago(stats.updatedAt, now) : "loading"}
          </StatusPill>
          <p className="font-mono text-[12px] text-fg-muted">
            <Counter value={stats?.players ?? 0} className="text-fg" /> players ·{" "}
            <Counter value={stats?.verifiedRepairs ?? 0} className="text-healthy" /> verified repairs
          </p>
        </div>
      </div>

      {/* how the test works */}
      <ol className="mt-10 grid gap-px overflow-hidden rounded-[var(--radius-card)] border border-border bg-border md:grid-cols-3">
        <SetupStep n="1" title="A player presses Start" detail="Practice runs are never counted." />
        <SetupStep
          n="2"
          title="Flagsmith picks the hint style"
          detail={
            <>
              flag <span className="text-fg-secondary">{EXPERIMENT_FLAG}</span> · 50/50 split
            </>
          }
        />
        <SetupStep
          n="3"
          title="Fixed within 3 minutes? That's a conversion"
          detail={
            <>
              server verifies, then sends <span className="text-fg-secondary">{EXPERIMENT_EVENT}</span>
            </>
          }
        />
      </ol>

      {/* the two variants */}
      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
        {VARIANTS.map((v, i) => {
          const s = stats?.byVariant[v.key];
          const enrolled = s?.enrolled ?? 0;
          const repaired = s?.repaired ?? 0;
          const rate = enrolled > 0 ? repaired / enrolled : null;
          return (
            <Panel key={v.key} className="flex min-w-0 flex-col p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-fg-muted">
                    <span className="h-2 w-2 rounded-full" style={{ background: VARIANT_COLOR[v.flagsmithKey] }} aria-hidden />
                    Hint {v.letter} · {v.flagsmithKey}
                  </p>
                  <h2 className="mt-2 text-[19px] font-semibold tracking-[-0.02em]">{v.label}</h2>
                  <p className="mt-1 text-[13px] text-fg-muted">{v.blurb}</p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-[34px] font-medium leading-none tabular text-fg">{pct(rate)}</p>
                  <p className="mt-1.5 text-[11.5px] text-fg-muted">repair rate</p>
                </div>
              </div>

              <div className="mt-5 h-2 overflow-hidden rounded-full bg-elevated">
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: VARIANT_COLOR[v.flagsmithKey] }}
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.round((rate ?? 0) * 100)}%` }}
                  transition={{ duration: 0.6, ease: ease.smooth, delay: i * 0.08 }}
                />
              </div>

              <dl className="mt-5 grid grid-cols-4 gap-3">
                <Stat label="players" value={enrolled} />
                <Stat label="repairs" value={repaired} tone={repaired ? "text-healthy" : undefined} />
                <Stat label="hint opened" value={s?.hinted ?? 0} />
                <Stat label="median" value={s?.medianMs ? formatMs(s.medianMs) : "—"} />
              </dl>

              <div className="mt-5 min-w-0 flex-1 rounded-[10px] border border-border bg-canvas/60 px-4 py-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-muted">What players see · case {SAMPLE.id}</p>
                <p className="mt-2 font-mono text-[12px] leading-[1.75] text-fg-muted">{v.preview}</p>
              </div>
            </Panel>
          );
        })}
      </div>

      {/* verdict */}
      <Panel className="mt-6 overflow-hidden">
        {results?.treatment ? (
          <div className="p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold">Flagsmith&apos;s result</h2>
              <StatusPill status="accent">{results.isFinal ? "Final" : "Updating"}</StatusPill>
            </div>
            <div className="mt-5 grid gap-6 sm:grid-cols-3">
              <Fact label="Chance B beats A" value={pct(results.treatment.chanceToWin, 1)} strong />
              <Fact label="Lift" value={`${results.treatment.lift >= 0 ? "+" : ""}${pct(results.treatment.lift, 1)}`} />
              <Fact label="95% credible interval" value={`${pct(results.treatment.ciLow, 0)} to ${pct(results.treatment.ciHigh, 0)}`} />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:items-center">
            <div>
              <StatusPill status="unknown" pulse>
                Collecting data
              </StatusPill>
              <h2 className="mt-3 text-[19px] font-semibold tracking-[-0.02em]">No winner yet, and we won&apos;t fake one.</h2>
              <p className="mt-2 max-w-[460px] text-[13.5px] leading-[1.6] text-fg-secondary">
                Flagsmith shows a winner once each hint has {MIN_IDENTITIES} players and {MIN_CONVERSIONS} repairs. Every
                counted run moves these bars.
              </p>
              <ButtonLink href="/play" className="mt-5">
                Play a counted round <span aria-hidden>→</span>
              </ButtonLink>
            </div>
            <div className="space-y-4">
              {VARIANTS.map((v) => {
                const fs = fsByKey.get(v.flagsmithKey);
                return (
                  <div key={v.key}>
                    <div className="flex items-center justify-between gap-3 text-[13px]">
                      <span className="flex items-center gap-2 text-fg">
                        <span className="h-2 w-2 rounded-full" style={{ background: VARIANT_COLOR[v.flagsmithKey] }} aria-hidden />
                        Hint {v.letter}
                      </span>
                      <span className="font-mono text-[12px] text-fg-muted">
                        <span className="text-fg">{fs?.exposed ?? 0}</span>/{MIN_IDENTITIES} players ·{" "}
                        <span className="text-fg">{fs?.converted ?? 0}</span>/{MIN_CONVERSIONS} repairs
                      </span>
                    </div>
                    <Progress value={(fs?.exposed ?? 0) / MIN_IDENTITIES} color={VARIANT_COLOR[v.flagsmithKey]} />
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <p className="border-t border-border bg-canvas/40 px-6 py-2.5 font-mono text-[10.5px] text-fg-muted">
          {results?.source === "live"
            ? "Live from the Flagsmith results API"
            : results?.source === "snapshot"
              ? "Flagsmith results snapshot"
              : "No Flagsmith results yet"}
          {results?.asOf ? ` · computed ${ago(results.asOf, now)}` : ""} · the cards above use our own server&apos;s counts
        </p>
      </Panel>

      {/* integrity */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel className="min-w-0 p-6">
          <h2 className="text-base font-semibold">The Doctor, checking our own experiment</h2>
          <ul className="mt-4 space-y-3.5 text-[13px]">
            <HealthRow
              ok={(results?.variants.length ?? 0) > 0}
              pending={!results || results.variants.length === 0}
              label="Exposures reach Flagsmith"
              detail={
                results && results.variants.length
                  ? results.variants.map((v) => `${v.key}: ${v.exposed}`).join(" · ")
                  : "Waiting for the first counted run."
              }
            />
            <HealthRow
              ok={results?.srmPValue === null || results?.srmPValue === undefined ? false : results.srmPValue > 0.01}
              pending={results?.srmPValue === null || results?.srmPValue === undefined}
              label="Traffic split matches 50/50"
              detail={
                results?.srmPValue === null || results?.srmPValue === undefined
                  ? "Flagsmith runs this check once there is enough traffic."
                  : `sample ratio p = ${results.srmPValue.toFixed(3)}${results.srmPValue <= 0.01 ? ", investigate the split" : ""}`
              }
            />
            <HealthRow ok label="Exposure only when a counted run starts" detail="getExperimentFlag runs on Start, never for practice." />
            <HealthRow ok label="Conversion name matches the metric" detail={`trackEvent('${EXPERIMENT_EVENT}') = metric event ${EXPERIMENT_EVENT}`} />
          </ul>
        </Panel>

        <Panel className="min-w-0 p-6">
          <h2 className="text-base font-semibold">Our server vs Flagsmith</h2>
          <p className="mt-1 text-[12.5px] text-fg-muted">Both sides should count the same players. Amber means they are more than 10% apart.</p>
          <table className="mt-4 w-full font-mono text-[12.5px]">
            <thead>
              <tr className="text-left text-[11px] text-fg-muted">
                <th className="pb-2 font-normal">hint</th>
                <th className="pb-2 text-right font-normal">players (ours / theirs)</th>
                <th className="pb-2 text-right font-normal">repairs (ours / theirs)</th>
              </tr>
            </thead>
            <tbody>
              {VARIANTS.map((v) => {
                const ours = stats?.fromFlagsmith?.[v.key];
                const theirs = fsByKey.get(v.flagsmithKey);
                const cell = (a: number | undefined, b: number | undefined) => {
                  const off = a !== undefined && b !== undefined && Math.abs(a - b) > Math.max(1, 0.1 * Math.max(a, b));
                  return (
                    <span className={off ? "text-warning" : "text-fg-secondary"}>
                      {a ?? 0} <span className="text-fg-muted">/</span> {b ?? "—"}
                    </span>
                  );
                };
                return (
                  <tr key={v.key} className="border-t border-border/60">
                    <td className="whitespace-nowrap py-2 text-fg">
                      {v.letter} · {v.flagsmithKey}
                    </td>
                    <td className="py-2 text-right">{cell(ours?.enrolled, theirs?.exposed)}</td>
                    <td className="py-2 text-right">{cell(ours?.repaired, theirs?.converted)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-3 text-[12px] leading-[1.55] text-fg-muted">
            A gap usually means an older snapshot, an ad blocker, or a player who left before the events were sent. The
            conversion is only sent after the server verifies the repair, never on the browser&apos;s word.
          </p>
        </Panel>
      </div>

      {/* only once there is something to show */}
      {hasTimeline && (
        <Panel className="mt-6 p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold">Over time, as Flagsmith counts it</h2>
            <p className="font-mono text-[11px] text-fg-muted">running totals per hint · Flagsmith results API</p>
          </div>
          <div className="mt-4">
            <Timeline points={results?.timeline ?? []} />
          </div>
        </Panel>
      )}

      {hasPlayers && (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Panel className="p-6">
            <h2 className="text-base font-semibold">Where players get stuck</h2>
            {failing.length === 0 ? (
              <p className="mt-3 text-[13px] text-fg-muted">No failed verifications yet.</p>
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
          </Panel>
          <Panel className="p-6">
            <h2 className="text-base font-semibold">Repairs by case</h2>
            <ul className="mt-4 space-y-2 font-mono text-[12.5px]">
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
          </Panel>
        </div>
      )}
    </div>
  );
}

function SetupStep({ n, title, detail }: { n: string; title: string; detail: ReactNode }) {
  return (
    <li className="flex gap-4 bg-surface px-5 py-4">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-accent/40 bg-accent/10 font-mono text-[12px] text-[#c4b0ff]">
        {n}
      </span>
      <div className="min-w-0">
        <p className="text-[14px] font-medium text-fg">{title}</p>
        <p className="mt-0.5 font-mono text-[11.5px] text-fg-muted">{detail}</p>
      </div>
    </li>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <div>
      <dt className="text-[11px] text-fg-muted">{label}</dt>
      <dd className={cn("mt-1 font-mono text-[17px] tabular text-fg", tone)}>
        {typeof value === "number" ? <Counter value={value} /> : value}
      </dd>
    </div>
  );
}

function Progress({ value, color }: { value: number; color: string }) {
  const w = Math.max(0, Math.min(1, value));
  return (
    <div className="mt-2 h-2 overflow-hidden rounded-full bg-elevated">
      <motion.div
        className="h-full rounded-full"
        style={{ background: color }}
        initial={{ width: 0 }}
        animate={{ width: `${w * 100}%` }}
        transition={{ duration: 0.6, ease: ease.smooth }}
      />
    </div>
  );
}

function Fact({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-muted">{label}</p>
      <p className={cn("mt-1 font-mono tabular", strong ? "text-[28px] text-healthy" : "text-[19px] text-fg")}>{value}</p>
    </div>
  );
}

function HealthRow({ ok, pending = false, label, detail }: { ok: boolean; pending?: boolean; label: string; detail: string }) {
  const tone = pending ? "text-fg-muted" : ok ? "text-healthy" : "text-critical";
  return (
    <li className="flex gap-3">
      <span
        className={cn(
          "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border font-mono text-[11px]",
          pending ? "border-border-strong" : ok ? "border-healthy/40 bg-healthy/10" : "border-critical/40 bg-critical/10",
          tone,
        )}
        aria-hidden
      >
        {pending ? "·" : ok ? "✓" : "✕"}
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
