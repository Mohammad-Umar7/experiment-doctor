"use client";

import Link from "next/link";
import { useState } from "react";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { DOCTOR_RECORD } from "@/lib/doctor-record";
import { formatMs } from "@/lib/game/time";
import { ease } from "@/lib/motion";
import { HINT_VARIANTS, type HintVariant } from "@/lib/site";

const VARIANT_LABEL: Record<HintVariant, string> = {
  [HINT_VARIANTS.control]: "full diagnostic report",
  [HINT_VARIANTS.challenger]: "one prioritized fix",
};

export function SuccessCard({
  elapsedMs,
  receipt,
  counted,
  variant,
  caseTitle,
  onPlayAgain,
}: {
  elapsedMs: number;
  receipt: string | null;
  counted: boolean;
  variant: HintVariant;
  caseTitle: string;
  onPlayAgain: () => void;
}) {
  const [handle, setHandle] = useState("");
  const [claimState, setClaimState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [claimed, setClaimed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const diff = elapsedMs - DOCTOR_RECORD.ms;
  const beat = diff < 0;
  const time = formatMs(elapsedMs);
  const shareUrl = typeof window !== "undefined" ? `${window.location.origin}/play` : "/play";
  const shareText = beat
    ? `I fixed a broken A/B test in ${time} and beat the AI Doctor (${DOCTOR_RECORD.time}). Can you?`
    : `I fixed a broken Flagsmith experiment in ${time}. The AI Doctor did it in ${DOCTOR_RECORD.time}. Can you beat it?`;

  async function claim(e: React.FormEvent) {
    e.preventDefault();
    if (!receipt) return;
    setClaimState("saving");
    setError(null);
    const res = await fetch("/api/game/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ receipt, handle }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setClaimState("error");
      setError(data.error ?? "Could not save your spot.");
      return;
    }
    setClaimed(data.handle);
    setClaimState("done");
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: ease.smooth }}
      className="rounded-[var(--radius-card)] border border-healthy/30 bg-surface p-6 shadow-[var(--shadow-healthy)]"
      role="status"
      aria-live="polite"
    >
      <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-healthy">Experiment revived</p>
      <p className="mt-3 font-mono text-[44px] font-medium leading-none tabular text-fg">{time}</p>
      <p className="mt-2 text-[14px] text-fg-secondary">
        {caseTitle} · verified by the server ·{" "}
        {beat ? (
          <span className="text-healthy">you beat the Doctor by {formatMs(-diff)}</span>
        ) : (
          <span>
            {formatMs(diff)} behind the Doctor ({DOCTOR_RECORD.time})
          </span>
        )}
      </p>

      {counted && (
        <p className="mt-4 rounded-md border border-border bg-canvas/60 px-3 py-2 text-[12.5px] text-fg-muted">
          This run counted in the Flagsmith experiment. Your hint style was the{" "}
          <span className="text-fg-secondary">{VARIANT_LABEL[variant]}</span>.
        </p>
      )}

      {receipt && claimState !== "done" && (
        <form onSubmit={claim} className="mt-5 flex flex-col gap-2 sm:flex-row">
          <label htmlFor="handle" className="sr-only">
            Leaderboard name
          </label>
          <input
            id="handle"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            maxLength={20}
            placeholder="Name for the leaderboard"
            autoComplete="nickname"
            className="h-11 flex-1 rounded-[8px] border border-border bg-canvas px-3 text-[14px] text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none"
          />
          <Button type="submit" disabled={claimState === "saving" || handle.trim().length < 2}>
            {claimState === "saving" ? "Saving…" : "Claim your spot"}
          </Button>
        </form>
      )}
      {error && <p className="mt-2 text-[13px] text-critical">{error}</p>}
      {claimState === "done" && claimed && (
        <p className="mt-5 text-[14px] text-fg">
          You&apos;re on the board as <span className="font-mono text-healthy">{claimed}</span>.{" "}
          <Link href="/leaderboard" className="text-fg-secondary underline underline-offset-4 hover:text-fg">
            See the leaderboard
          </Link>
        </p>
      )}
      {!receipt && counted && (
        <p className="mt-4 text-[13px] text-fg-muted">Repairs after the 3-minute limit don&apos;t go on the board.</p>
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        <a
          className="inline-flex h-10 items-center rounded-[8px] border border-border bg-elevated px-3 text-[13px] text-fg hover:border-border-strong"
          href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`}
          target="_blank"
          rel="noreferrer"
        >
          Share on X
        </a>
        <a
          className="inline-flex h-10 items-center rounded-[8px] border border-border bg-elevated px-3 text-[13px] text-fg hover:border-border-strong"
          href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`}
          target="_blank"
          rel="noreferrer"
        >
          Share on LinkedIn
        </a>
        <Button variant="ghost" size="sm" className="h-10" onClick={onPlayAgain}>
          Try another case
        </Button>
      </div>
    </motion.div>
  );
}

export function TimeoutCard({ onPractice, onPlayAgain }: { onPractice: () => void; onPlayAgain: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: ease.smooth }}
      className="rounded-[var(--radius-card)] border border-critical/30 bg-surface p-6"
      role="status"
      aria-live="polite"
    >
      <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-critical">Time&apos;s up</p>
      <p className="mt-3 text-[15px] text-fg">The patient is still flatlining. The bug is highlighted in the editor.</p>
      <p className="mt-1 text-[13px] text-fg-muted">You can keep fixing it as practice. Practice runs don&apos;t count.</p>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button onClick={onPractice}>Keep fixing</Button>
        <Button variant="secondary" onClick={onPlayAgain}>
          Try another case
        </Button>
      </div>
    </motion.div>
  );
}
