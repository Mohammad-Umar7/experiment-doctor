"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";
import { formatMs } from "@/lib/game/time";

/**
 * Countdown that renders straight to the DOM every frame, so React does not re-render
 * the page 60 times a second. Turns amber under 30s and red under 10s.
 */
export function RaceTimer({
  startedAt,
  limitMs,
  stoppedAt,
  onExpire,
  className,
}: {
  startedAt: number | null;
  limitMs: number;
  stoppedAt?: number | null;
  onExpire?: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const expired = useRef(false);

  useEffect(() => {
    expired.current = false;
    const el = ref.current;
    if (!el) return;

    const paint = (remaining: number) => {
      el.textContent = formatMs(remaining);
      el.dataset.tone = remaining <= 10_000 ? "critical" : remaining <= 30_000 ? "warning" : "normal";
    };

    if (!startedAt) {
      paint(limitMs);
      return;
    }
    if (stoppedAt) {
      paint(Math.max(0, limitMs - (stoppedAt - startedAt)));
      return;
    }

    let raf = 0;
    const tick = () => {
      const remaining = limitMs - (Date.now() - startedAt);
      paint(Math.max(0, remaining));
      if (remaining <= 0) {
        if (!expired.current) {
          expired.current = true;
          onExpire?.();
        }
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // onExpire identity changes every render; the timer should only restart on new times.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startedAt, stoppedAt, limitMs]);

  return (
    <span
      ref={ref}
      role="timer"
      aria-live="off"
      className={cn(
        "tabular font-mono font-medium transition-colors duration-300 data-[tone=critical]:text-critical data-[tone=normal]:text-fg data-[tone=warning]:text-warning",
        className,
      )}
    >
      {formatMs(limitMs)}
    </span>
  );
}
