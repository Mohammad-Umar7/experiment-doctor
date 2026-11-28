"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { motion, useReducedMotion } from "motion/react";
import { Button } from "@/components/ui/button";
import { ease } from "@/lib/motion";
import { cn } from "@/lib/cn";

export type TourStep = {
  /** Value of a `data-tour` attribute to spotlight. Omit it for a centered card. */
  target?: string;
  title: string;
  body: ReactNode;
};

type Rect = { top: number; left: number; width: number; height: number };

const PAD = 8;
const CARD_W = 360;
const GAP = 14;
const MARGIN = 16;
const NAV_H = 64;

function find(target?: string) {
  return target ? document.querySelector<HTMLElement>(`[data-tour="${target}"]`) : null;
}

function measure(target?: string): Rect | null {
  const el = find(target);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 };
}

const noop = () => () => {};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Below the target if it fits, else above, else beside it, else pinned to the bottom of the screen. */
function place(rect: Rect | null, vw: number, vh: number, cardH: number) {
  const w = Math.min(CARD_W, vw - MARGIN * 2);
  if (!rect) return { left: (vw - w) / 2, top: Math.max(MARGIN, (vh - cardH) / 2), w };
  const centerX = clamp(rect.left + rect.width / 2 - w / 2, MARGIN, vw - w - MARGIN);
  const below = rect.top + rect.height + GAP;
  if (below + cardH <= vh - MARGIN) return { left: centerX, top: below, w };
  const above = rect.top - GAP - cardH;
  if (above >= NAV_H) return { left: centerX, top: above, w };
  const visTop = Math.max(rect.top, NAV_H);
  const visBottom = Math.min(rect.top + rect.height, vh);
  const sideTop = clamp((visTop + visBottom) / 2 - cardH / 2, NAV_H, vh - cardH - MARGIN);
  if (rect.left + rect.width + GAP + w <= vw - MARGIN) return { left: rect.left + rect.width + GAP, top: sideTop, w };
  if (rect.left - GAP - w >= MARGIN) return { left: rect.left - GAP - w, top: sideTop, w };
  return { left: (vw - w) / 2, top: vh - cardH - MARGIN, w };
}

/**
 * A spotlight walkthrough. It dims the page, cuts a lit window around one element per step
 * and explains it in a card. Keyboard: → / ← to move, Esc to close. Nothing on the page is
 * clickable while it is open, so a tour can never start a game or send an event.
 */
export function Tour({
  steps,
  open,
  onClose,
  label = "Quick tour",
}: {
  steps: TourStep[];
  open: boolean;
  onClose: () => void;
  label?: string;
}) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [vp, setVp] = useState({ w: 1280, h: 800 });
  const [cardH, setCardH] = useState(220);
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  const cardRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const step = steps[i];
  const last = i === steps.length - 1;

  // Every tour starts from its first step next time it opens.
  const close = useCallback(() => {
    setI(0);
    onClose();
  }, [onClose]);

  // Bring the target into view, then keep the spotlight glued to it while the page moves.
  useEffect(() => {
    if (!open || !step) return;
    const el = find(step.target);
    if (el) {
      const r = el.getBoundingClientRect();
      const fits = r.top >= NAV_H + 8 && r.bottom <= window.innerHeight - 24;
      if (!fits) el.scrollIntoView({ block: r.height > window.innerHeight * 0.6 ? "start" : "center", behavior: reduce ? "auto" : "smooth" });
    }
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        setVp({ w: window.innerWidth, h: window.innerHeight });
        setRect(measure(step.target));
      });
    };
    update();
    const settle = setTimeout(update, 450);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(settle);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, step, reduce]);

  useLayoutEffect(() => {
    if (open && cardRef.current) setCardH(cardRef.current.offsetHeight);
  }, [open, i, vp.w]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") setI((n) => (n < steps.length - 1 ? n + 1 : n));
      else if (e.key === "ArrowLeft") setI((n) => Math.max(0, n - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close, steps.length]);

  if (!mounted || !open || !step) return null;

  const pos = place(rect, vp.w, vp.h, cardH);
  const spring = reduce ? { duration: 0 } : { duration: 0.42, ease: ease.smooth };

  return createPortal(
    <div className="fixed inset-0 z-[70]" aria-live="polite">
      {/* dim layer with a lit window around the target */}
      {rect ? (
        <motion.div
          className="pointer-events-none fixed rounded-[14px]"
          initial={false}
          animate={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
          transition={spring}
          style={{
            boxShadow:
              "0 0 0 2px rgba(150,115,255,0.95), 0 0 36px 4px rgba(104,55,252,0.45), 0 0 0 9999px rgba(4,5,8,0.76)",
          }}
        />
      ) : (
        <motion.div
          className="fixed inset-0 bg-[rgba(4,5,8,0.76)]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.25 }}
        />
      )}

      <motion.div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        className="fixed rounded-[14px] border border-border-strong bg-surface p-5 shadow-[0_24px_64px_rgba(0,0,0,0.55)]"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0, top: pos.top, left: pos.left }}
        transition={spring}
        style={{ width: pos.w }}
      >
        <div className="flex items-center justify-between gap-3">
          <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[#a98bff]">
            {label} · {i + 1} of {steps.length}
          </p>
          <button
            type="button"
            onClick={close}
            className="-mr-1.5 rounded-md px-2 py-1 text-[12px] text-fg-muted transition-colors hover:bg-elevated hover:text-fg"
          >
            Skip
          </button>
        </div>
        <div key={i}>
          <h2 id="tour-title" className="mt-2 text-[17px] font-semibold tracking-[-0.015em] text-fg">
            {step.title}
          </h2>
          <div className="mt-1.5 text-[13.5px] leading-[1.6] text-fg-secondary">{step.body}</div>
          <div className="mt-5 flex items-center justify-between gap-3">
            <div className="flex gap-1.5" aria-hidden>
              {steps.map((_, n) => (
                <span
                  key={n}
                  className={cn(
                    "h-1.5 rounded-full transition-all duration-300",
                    n === i ? "w-5 bg-accent" : n < i ? "w-1.5 bg-[#a98bff]/60" : "w-1.5 bg-border-strong",
                  )}
                />
              ))}
            </div>
            <div className="flex gap-2">
              {i > 0 && (
                <Button variant="ghost" size="sm" onClick={() => setI(i - 1)}>
                  Back
                </Button>
              )}
              <Button size="sm" autoFocus onClick={() => (last ? close() : setI(i + 1))}>
                {last ? "Got it" : "Next"}
                {!last && <span aria-hidden>→</span>}
              </Button>
            </div>
          </div>
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}
