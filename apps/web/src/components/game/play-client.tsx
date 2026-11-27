"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CodeEditor, type LineMark } from "@/components/game/code-editor";
import { EvidencePanel } from "@/components/game/evidence-panel";
import { HintPanel } from "@/components/game/hint-panel";
import { RaceTimer } from "@/components/game/race-timer";
import { SuccessCard, TimeoutCard } from "@/components/game/result-card";
import { VerifyButton } from "@/components/game/verify-button";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/panel";
import { StatusPill } from "@/components/ui/status-pill";
import { CASES, getCase, type GameCase } from "@/lib/game/cases";
import { expose, flagsmithConfigured, getPlayerId, practiceVariant, prepare, trackHintOpened, trackVerifiedRepair } from "@/lib/game/experiment";
import type { AssignmentSource } from "@/lib/game/types";
import type { StageKey } from "@/lib/game/verify";
import { DOCTOR_RECORD } from "@/lib/doctor-record";
import { ease } from "@/lib/motion";
import { sounds, setSoundEnabled, soundEnabled } from "@/lib/sound";
import { CHALLENGE_LIMIT_MS, type HintVariant } from "@/lib/site";
import { useResurrection } from "@/lib/use-resurrection";

type Phase = "intro" | "starting" | "playing" | "verifying" | "reviving" | "won" | "timeout";

const STAGE_LABEL: Record<StageKey, string> = {
  app: "your code",
  sdk: "the SDK",
  flagsmith: "Flagsmith",
  warehouse: "the warehouse join",
  results: "the results",
};

function pickCase(exclude?: string): GameCase {
  const pool = CASES.filter((c) => c.id !== exclude);
  return pool[Math.floor(Math.random() * pool.length)];
}

export function PlayClient({ initialCaseId }: { initialCaseId?: string }) {
  const [game, setGame] = useState<GameCase>(() => getCase(initialCaseId ?? "") ?? CASES[0]);
  const [phase, setPhase] = useState<Phase>("intro");
  const [code, setCode] = useState(game.code);
  const [token, setToken] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [stoppedAt, setStoppedAt] = useState<number | null>(null);
  const [variant, setVariant] = useState<HintVariant>("full_report");
  const [source, setSource] = useState<AssignmentSource>("local");
  const [counted, setCounted] = useState(true);
  const [hintOpen, setHintOpen] = useState(false);
  const [brokenStage, setBrokenStage] = useState<StageKey | null>(game.brokenStage);
  const [message, setMessage] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [revealBug, setRevealBug] = useState(false);
  const [sound, setSound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pidRef = useRef<string>("");

  const step = useResurrection(phase === "reviving" || phase === "won", () => setPhase("won"));

  // Pick a random case on first load (after hydration) unless one was linked.
  useEffect(() => {
    pidRef.current = getPlayerId();
    void prepare(pidRef.current);
    setSound(soundEnabled());
    if (!initialCaseId) {
      const next = pickCase();
      setGame(next);
      setCode(next.code);
      setBrokenStage(next.brokenStage);
    }
  }, [initialCaseId]);

  const begin = useCallback(
    async (practice: boolean, nextGame: GameCase = game) => {
      setPhase("starting");
      setError(null);
      const pid = pidRef.current || getPlayerId();
      const assignment = practice
        ? { variant: practiceVariant(pid), source: "local" as AssignmentSource }
        : await expose(pid);
      const res = await fetch("/api/game/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerId: pid,
          caseId: nextGame.id,
          variant: assignment.variant,
          source: assignment.source,
          practice,
        }),
      }).catch(() => null);
      if (!res || !res.ok) {
        setError("Could not start the challenge. Check your connection and try again.");
        setPhase("intro");
        return;
      }
      const data = (await res.json()) as { token: string; counted: boolean };
      setGame(nextGame);
      setCode(nextGame.code);
      setBrokenStage(nextGame.brokenStage);
      setToken(data.token);
      setCounted(data.counted);
      setVariant(assignment.variant);
      setSource(assignment.source);
      setHintOpen(false);
      setMessage(null);
      setReceipt(null);
      setRevealBug(false);
      setStoppedAt(null);
      setStartedAt(Date.now());
      setPhase("playing");
    },
    [game],
  );

  const verify = useCallback(async () => {
    if (!token || (phase !== "playing" && phase !== "timeout")) return;
    const wasTimeout = phase === "timeout";
    setPhase("verifying");
    setMessage(null);
    sounds.verify();
    const [res] = await Promise.all([
      fetch("/api/game/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, code }),
      }).catch(() => null),
      new Promise((r) => setTimeout(r, 400)), // let the charge finish
    ]);
    if (!res || !res.ok) {
      setMessage("Verification is unavailable right now. Your code is safe here, try again in a moment.");
      setPhase(wasTimeout ? "timeout" : "playing");
      return;
    }
    const data = await res.json();
    if (!data.ok) {
      setBrokenStage(data.brokenStage ?? brokenStage);
      setMessage(
        data.syntaxError
          ? `Syntax error: ${data.syntaxError}`
          : `Conversions still missing. The signal still dies at ${STAGE_LABEL[data.brokenStage as StageKey] ?? "the pipeline"}.`,
      );
      setPhase(wasTimeout ? "timeout" : "playing");
      return;
    }
    setStoppedAt(Date.now());
    setElapsedMs(data.elapsedMs);
    setReceipt(data.receipt ?? null);
    setBrokenStage(null);
    sounds.success();
    if (counted && data.withinLimit && data.firstSuccess) void trackVerifiedRepair(data.elapsedMs);
    setPhase("reviving");
  }, [token, phase, code, brokenStage, counted]);

  const openHint = useCallback(() => {
    setHintOpen(true);
    if (token) {
      void fetch("/api/game/hint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      }).catch(() => undefined);
    }
    if (counted) void trackHintOpened();
  }, [token, counted]);

  const onExpire = useCallback(() => {
    sounds.timeout();
    setRevealBug(true);
    setPhase((p) => (p === "playing" ? "timeout" : p));
  }, []);

  const playAgain = useCallback(() => {
    const next = pickCase(game.id);
    setPhase("intro");
    setGame(next);
    setCode(next.code);
    setBrokenStage(next.brokenStage);
    setStartedAt(null);
    setStoppedAt(null);
    setToken(null);
  }, [game.id]);

  const marks: LineMark[] = useMemo(
    () => (revealBug ? game.bugLines.map((line) => ({ line, tone: "critical" as const })) : []),
    [revealBug, game.bugLines],
  );

  const playing = phase === "playing" || phase === "verifying" || phase === "timeout";
  const done = phase === "reviving" || phase === "won";

  return (
    <div className="mx-auto w-full max-w-[1280px] px-4 pb-16 pt-6 sm:px-6">
      {/* top bar */}
      <div className="flex flex-col gap-4 border-b border-border pb-5 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <Eyebrow>
            Human vs Doctor · Case {game.id}
            {!counted && phase !== "intro" ? " · practice" : ""}
          </Eyebrow>
          <h1 className="mt-1.5 text-[26px] font-semibold tracking-[-0.03em] sm:text-[32px]">{game.title}</h1>
        </div>
        <div className="flex items-end gap-6 sm:gap-8">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-muted">Your time remaining</p>
            <RaceTimer
              startedAt={startedAt}
              stoppedAt={stoppedAt}
              limitMs={CHALLENGE_LIMIT_MS}
              onExpire={onExpire}
              className="text-[36px] leading-none sm:text-[44px]"
            />
          </div>
          <div className="hidden sm:block">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-muted">Doctor&apos;s record</p>
            <p className="font-mono text-[22px] leading-none text-healthy tabular">{DOCTOR_RECORD.time}</p>
            <p className="mt-1 font-mono text-[10px] text-fg-muted">{DOCTOR_RECORD.tokens.toLocaleString("en-US")} tokens</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setSoundEnabled(!sound);
              setSound(!sound);
            }}
            className="mb-0.5 flex h-11 w-11 items-center justify-center rounded-md border border-border text-fg-secondary hover:text-fg"
            aria-pressed={sound}
            aria-label={sound ? "Mute sounds" : "Turn sounds on"}
            title={sound ? "Sound on" : "Sound off"}
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden>
              <path d="M3 8v4h3l4 3V5L6 8H3z" fill="currentColor" />
              {sound ? (
                <path d="M13 7a4 4 0 010 6M15 5a7 7 0 010 10" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
              ) : (
                <path d="M13 8l4 4M17 8l-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              )}
            </svg>
          </button>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* left: case + editor */}
        <div className="min-w-0 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <p className="max-w-[640px] text-[14px] leading-[1.6] text-fg-secondary">{game.symptom}</p>
            <StatusPill status={done ? "healthy" : "critical"} pulse={!done} className="shrink-0">
              {done ? "Healthy" : "Unhealthy"}
            </StatusPill>
          </div>

          <div className="relative overflow-hidden rounded-[var(--radius-card)] border border-border">
            <div className="flex items-center justify-between border-b border-border bg-surface px-4 py-2.5">
              <div className="flex items-center gap-2 font-mono text-[12px]">
                <span className="text-fg">{game.file}</span>
                <span className="text-fg-muted">{phase === "intro" ? "read only until you start" : done ? "repaired" : "editable"}</span>
              </div>
              {playing && (
                <button
                  type="button"
                  onClick={() => setCode(game.code)}
                  className="rounded px-2 py-1 font-mono text-[11px] text-fg-muted hover:bg-elevated hover:text-fg"
                >
                  Reset file
                </button>
              )}
            </div>
            <CodeEditor
              value={code}
              onChange={setCode}
              onSubmit={verify}
              readOnly={!playing}
              marks={marks}
              label={`${game.file}, editable source of the broken experiment`}
              className="max-h-[560px] min-h-[420px]"
            />

            {/* intro overlay */}
            <AnimatePresence>
              {(phase === "intro" || phase === "starting") && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.25, ease: ease.smooth }}
                  className="absolute inset-0 top-[41px] z-30 flex items-center justify-center bg-canvas/85 p-4"
                >
                  <Intro
                    game={game}
                    starting={phase === "starting"}
                    error={error}
                    onStart={() => begin(false)}
                    onPractice={() => begin(true)}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <AnimatePresence>
            {message && (
              <motion.p
                key={message}
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                role="alert"
                className="rounded-[8px] border border-critical/30 bg-critical/[0.06] px-4 py-2.5 font-mono text-[12.5px] text-critical"
              >
                {message}
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        {/* right: evidence + actions */}
        <aside className="space-y-4">
          {phase === "won" && (
            <SuccessCard
              elapsedMs={elapsedMs}
              receipt={receipt}
              counted={counted}
              variant={variant}
              caseTitle={`Case ${game.id}`}
              onPlayAgain={playAgain}
            />
          )}
          {phase === "timeout" && (
            <TimeoutCard
              onPractice={() => {
                setCounted(false);
                setPhase("timeout");
              }}
              onPlayAgain={playAgain}
            />
          )}
          <EvidencePanel game={game} brokenStage={brokenStage} step={step} />
          {!done && (
            <>
              <HintPanel game={game} variant={variant} open={hintOpen} onOpen={openHint} disabled={!playing} />
              <div className="sticky bottom-3 z-20 lg:static">
                <VerifyButton onClick={verify} verifying={phase === "verifying"} disabled={!playing} />
              </div>
            </>
          )}
          <p className="text-[11.5px] leading-[1.55] text-fg-muted">
            {source === "flagsmith" || flagsmithConfigured
              ? "Hint style assigned by a live Flagsmith experiment (doctor_hint_style)."
              : "Flagsmith is not configured here, so the hint style uses a local 50/50 split."}{" "}
            Repairs are statically verified: the server parses your code and replays the Flagsmith SDK call order (init, identify, exposure, conversion, flush). Nothing you type is executed. For a live pipeline check, the CLI and the self-hosted lab verify real events per identity.
          </p>
        </aside>
      </div>
    </div>
  );
}

function Intro({
  game,
  starting,
  error,
  onStart,
  onPractice,
}: {
  game: GameCase;
  starting: boolean;
  error: string | null;
  onStart: () => void;
  onPractice: () => void;
}) {
  return (
    <div className="w-full max-w-[460px] rounded-[var(--radius-card)] border border-border bg-surface p-6 shadow-[var(--shadow-card)]">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-critical">Incoming case {game.id}</p>
      <h2 className="mt-2 text-xl font-semibold tracking-[-0.02em]">Restore the missing conversions.</h2>
      <ul className="mt-4 space-y-1.5 text-[13.5px] leading-[1.55] text-fg-secondary">
        <li>· 3 minutes. The server keeps the clock.</li>
        <li>· Edit the code, then verify. The server checks the SDK call order statically, it never runs your code.</li>
        <li>· One hint from the Doctor if you get stuck.</li>
        <li>
          · Doctor&apos;s record: <span className="font-mono text-healthy">{DOCTOR_RECORD.time}</span>
        </li>
      </ul>
      <p className="mt-4 rounded-md border border-accent/30 bg-accent/[0.06] px-3 py-2 text-[12px] leading-[1.55] text-fg-secondary">
        This challenge is a Flagsmith A/B test. We record an anonymous random ID, which hint style you got and whether you
        fixed it in time. No personal data.
      </p>
      {error && <p className="mt-3 text-[13px] text-critical">{error}</p>}
      <div className="mt-5 flex flex-col gap-2 sm:flex-row">
        <Button size="lg" className="flex-1" onClick={onStart} disabled={starting} autoFocus>
          {starting ? "Starting…" : "Start the clock"}
        </Button>
        <Button size="lg" variant="ghost" onClick={onPractice} disabled={starting}>
          Practice, not counted
        </Button>
      </div>
    </div>
  );
}
