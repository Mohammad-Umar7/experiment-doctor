"use client";

import { AnimatePresence, motion } from "motion/react";
import type { GameCase } from "@/lib/game/cases";
import { HINT_VARIANTS, type HintVariant } from "@/lib/site";
import { ease } from "@/lib/motion";
import { cn } from "@/lib/cn";

/**
 * The flagged experience. Both variants share the button, position, latency and
 * animation; only the presentation of the same evidence differs:
 *   full_report: every check, the failing one explained
 *   one_fix:     the single prioritized repair with a diff
 */
export function HintPanel({
  game,
  variant,
  open,
  onOpen,
  disabled,
}: {
  game: GameCase;
  variant: HintVariant;
  open: boolean;
  onOpen: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="rounded-[10px] border border-border bg-canvas/60">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div>
          <p className="text-[13px] font-medium text-fg">Ask the Doctor</p>
          <p className="text-[12px] text-fg-muted">One hint per case. Using it is fine.</p>
        </div>
        <button
          type="button"
          onClick={onOpen}
          disabled={disabled || open}
          className="h-9 shrink-0 rounded-[8px] border border-border bg-elevated px-3 text-[13px] text-fg transition-[transform,border-color] duration-[140ms] hover:-translate-y-px hover:border-border-strong active:scale-[0.98] disabled:opacity-50 disabled:hover:translate-y-0"
          aria-expanded={open}
        >
          {open ? "Hint shown" : "Request hint"}
        </button>
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="hint"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: ease.smooth }}
            className="overflow-hidden"
          >
            <div className="border-t border-border px-4 py-3" aria-live="polite">
              {variant === HINT_VARIANTS.control ? <FullReport game={game} /> : <OneFix game={game} />}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function FullReport({ game }: { game: GameCase }) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-muted">Diagnostic report</p>
      <ul className="mt-2 space-y-1.5">
        {game.fullReport.map((check) => (
          <li key={check.label} className="text-[12.5px] leading-[1.5]">
            <span className={cn("mr-2 font-mono", check.ok ? "text-healthy" : "text-critical")} aria-hidden>
              {check.ok ? "✓" : "✕"}
            </span>
            <span className={check.ok ? "text-fg-secondary" : "text-fg"}>{check.label}</span>
            <span className="sr-only">{check.ok ? " passed" : " failed"}</span>
            {!check.ok && check.detail && <p className="ml-5 mt-0.5 text-fg-muted">{check.detail}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function OneFix({ game }: { game: GameCase }) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-muted">Recommended repair</p>
      <p className="mt-2 text-[13px] text-fg">{game.oneFix.instruction}</p>
      <pre className="mt-2 overflow-x-auto rounded-md border border-border bg-canvas px-3 py-2 font-mono text-[12px] leading-[1.6]">
        {game.oneFix.before.split("\n").map((line, i) => (
          <div key={`b${i}`} className="text-critical">
            − {line}
          </div>
        ))}
        {game.oneFix.after.split("\n").map((line, i) => (
          <div key={`a${i}`} className="text-healthy">
            + {line}
          </div>
        ))}
      </pre>
      <p className="mt-2 text-[12px] text-fg-muted">The remaining checks passed.</p>
    </div>
  );
}
