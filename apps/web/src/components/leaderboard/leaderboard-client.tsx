"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ButtonLink } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/panel";
import { StatusPill } from "@/components/ui/status-pill";
import { DOCTOR_RUNS, doctorRecordFor } from "@/lib/doctor-record";
import { CASES } from "@/lib/game/cases";
import type { LeaderboardEntry } from "@/lib/game/types";
import { formatMs } from "@/lib/game/time";
import { ease } from "@/lib/motion";
import { cn } from "@/lib/cn";

const caseTitle = (id: string) => CASES.find((c) => c.id === id)?.title ?? `Case ${id}`;

export function LeaderboardClient() {
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await fetch("/api/leaderboard", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { entries: LeaderboardEntry[] };
        if (alive) {
          setEntries(data.entries);
          setFailed(false);
        }
      } catch {
        if (alive) setFailed(true);
      }
    }
    void load();
    const iv = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 10_000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, []);

  const humansAhead = entries?.filter((e) => e.elapsedMs < doctorRecordFor(e.caseId).ms).length ?? 0;

  return (
    <div className="mx-auto w-full max-w-[960px] px-4 pb-20 pt-10 sm:px-6 sm:pt-14">
      <Eyebrow>Leaderboard</Eyebrow>
      <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <h1 className="text-[32px] font-semibold tracking-[-0.03em] sm:text-[40px]">Beat the machine.</h1>
        <StatusPill status="healthy" pulse>
          Live
        </StatusPill>
      </div>
      <p className="mt-3 max-w-[620px] text-[15px] leading-[1.6] text-fg-secondary">
        Verified repairs inside the 3-minute limit, fastest first. Every time comes from the server clock.{" "}
        {humansAhead > 0
          ? `${humansAhead} ${humansAhead === 1 ? "human has" : "humans have"} beaten the Doctor so far.`
          : "No human has beaten the Doctor yet."}
      </p>

      {/* AI benchmark, pinned apart so a faster human really takes first place */}
      <div className="mt-8 rounded-[var(--radius-card)] border border-accent/30 bg-accent/[0.06] px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[#a98bff]">AI benchmark</span>
            <span className="text-[15px] font-medium text-fg">Experiment Doctor</span>
          </div>
          <p className="font-mono text-[11px] text-fg-muted">
            measured runs · {Object.values(DOCTOR_RUNS)[0]?.model} with the Doctor skill · same code as the game
          </p>
        </div>
        <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {CASES.map((c) => {
            const d = doctorRecordFor(c.id);
            return (
              <li key={c.id} className="rounded-md border border-border bg-canvas/50 px-3 py-2">
                <p className="truncate font-mono text-[10px] uppercase tracking-[0.1em] text-fg-muted">
                  {c.id} {c.title}
                </p>
                <p className="mt-0.5 font-mono text-[15px] tabular text-healthy">{d.time}</p>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="mt-4 overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
        <div className="grid grid-cols-[48px_1fr_auto] gap-4 border-b border-border px-5 py-3 font-mono text-[10px] uppercase tracking-[0.14em] text-fg-muted sm:grid-cols-[56px_1fr_200px_120px]">
          <span>Rank</span>
          <span>Challenger</span>
          <span className="hidden sm:block">Case</span>
          <span className="text-right">Verified time</span>
        </div>

        {entries === null && !failed && (
          <ul aria-busy="true">
            {Array.from({ length: 5 }, (_, i) => (
              <li key={i} className="h-[57px] border-b border-border last:border-0">
                <div className="mx-5 mt-5 h-3 w-1/3 animate-pulse rounded bg-elevated" />
              </li>
            ))}
          </ul>
        )}

        {failed && entries === null && (
          <p className="px-5 py-10 text-center text-[14px] text-fg-muted">The leaderboard is unavailable right now.</p>
        )}

        {entries && entries.length === 0 && (
          <div className="px-5 py-14 text-center">
            <p className="text-[15px] text-fg">No verified repairs yet.</p>
            <p className="mt-1 text-[13px] text-fg-muted">The first name on this board is still open.</p>
            <ButtonLink href="/play" className="mt-5">
              Take the first spot
            </ButtonLink>
          </div>
        )}

        {entries && entries.length > 0 && (
          <motion.ol layout>
            <AnimatePresence initial={false}>
              {entries.map((e, i) => {
                const beat = e.elapsedMs < doctorRecordFor(e.caseId).ms;
                return (
                  <motion.li
                    layout
                    key={e.sid}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.3, ease: ease.smooth }}
                    className="grid grid-cols-[48px_1fr_auto] items-center gap-4 border-b border-border px-5 py-3.5 last:border-0 sm:grid-cols-[56px_1fr_200px_120px]"
                  >
                    <span className={cn("font-mono text-[13px] tabular", i < 3 ? "text-fg" : "text-fg-muted")}>
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-[14px] font-medium text-fg">{e.handle}</span>
                      {beat && (
                        <span className="shrink-0 rounded-full border border-healthy/30 bg-healthy/[0.08] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-healthy">
                          Beat Doctor
                        </span>
                      )}
                      {e.usedHint && <span className="shrink-0 font-mono text-[10px] text-fg-muted">hint</span>}
                    </span>
                    <span className="hidden truncate text-[13px] text-fg-secondary sm:block">
                      {e.caseId} · {caseTitle(e.caseId)}
                    </span>
                    <span className={cn("text-right font-mono text-[15px] tabular", beat ? "text-healthy" : "text-fg")}>
                      {formatMs(e.elapsedMs)}
                    </span>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </motion.ol>
        )}
      </div>

      <p className="mt-4 text-[12px] leading-[1.6] text-fg-muted">
        Humans and the Doctor do not race under identical conditions: the Doctor reads the files and the Flagsmith config
        through its CLI, humans read the screen. Runs that used the hint are marked.
      </p>
    </div>
  );
}
