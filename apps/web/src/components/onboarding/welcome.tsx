"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { LogoMark } from "@/components/site/logo";
import { DOCTOR_RUNS } from "@/lib/doctor-record";
import { ease } from "@/lib/motion";
import { OPEN_GUIDE_EVENT, WELCOME_KEY, markSeen, seen } from "@/lib/onboarding";

type Path = { href: string; title: string; body: string; meta: string; icon: ReactNode; primary?: boolean };

const icon = (d: string) => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);

const secs = Object.values(DOCTOR_RUNS).map((r) => r.ms / 1000);
const DOCTOR_RANGE = `${Math.floor(Math.min(...secs))} to ${Math.round(Math.max(...secs))} seconds`;

const PATHS: Path[] = [
  {
    href: "/play",
    title: "Play: beat the AI",
    body: `Fix a broken A/B test in 3 minutes. The AI Doctor takes ${DOCTOR_RANGE}.`,
    meta: "3 min",
    icon: icon("M8 5v14l11-7z"),
    primary: true,
  },
  {
    href: "/report",
    title: "Check your code",
    body: "Paste code that uses Flagsmith and get a diagnosis. It runs in your browser.",
    meta: "1 min",
    icon: icon("M4 12h4l2-5 4 10 2-5h4"),
  },
  {
    href: "/rescue",
    title: "See the live A/B test",
    body: "The game is a real Flagsmith experiment. See which hint helps players more.",
    meta: "live",
    icon: icon("M4 19V5M4 19h16M8 15l3-4 3 2 5-6"),
  },
  {
    href: "/#install",
    title: "Use it on your project",
    body: "A CLI, a skill for AI coding agents and a GitHub check.",
    meta: "devs",
    icon: icon("M9 8l-4 4 4 4M15 8l4 4-4 4"),
  },
];

/** Shown once, on the first visit to any page except the game (which has its own tour) and share pages. */
export function Welcome() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const reduce = useReducedMotion();
  const onPlay = pathname.startsWith("/play");

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (onPlay || pathname.startsWith("/s/") || seen(WELCOME_KEY)) return;
    const t = setTimeout(() => setOpen(true), 700);
    return () => clearTimeout(t);
  }, [pathname, onPlay]);

  useEffect(() => {
    const onGuide = () => {
      if (!onPlay) setOpen(true);
    };
    window.addEventListener(OPEN_GUIDE_EVENT, onGuide);
    return () => window.removeEventListener(OPEN_GUIDE_EVENT, onGuide);
  }, [onPlay]);

  const close = useCallback(() => {
    markSeen(WELCOME_KEY);
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="welcome"
          className="fixed inset-0 z-[80] flex items-end justify-center bg-[rgba(4,5,8,0.72)] p-3 backdrop-blur-[2px] sm:items-center sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduce ? 0 : 0.2 }}
          onClick={(e) => e.target === e.currentTarget && close()}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="welcome-title"
            aria-describedby="welcome-body"
            className="relative w-full max-w-[560px] overflow-hidden rounded-[18px] border border-border-strong bg-surface shadow-[0_32px_80px_rgba(0,0,0,0.6)]"
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: reduce ? 0 : 0.35, ease: ease.smooth }}
          >
            <div aria-hidden className="pointer-events-none absolute -top-32 left-1/2 h-56 w-[420px] -translate-x-1/2 rounded-full bg-accent/20 blur-[80px]" />
            <div className="relative px-6 pb-2 pt-6 sm:px-7 sm:pt-7">
              <div className="flex items-center justify-between">
                <LogoMark className="h-9 w-9" />
                <button
                  type="button"
                  onClick={close}
                  className="flex h-9 w-9 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-elevated hover:text-fg"
                  aria-label="Close"
                >
                  <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden>
                    <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
              <h2 id="welcome-title" className="mt-4 text-[24px] font-semibold leading-[1.15] tracking-[-0.03em] sm:text-[26px]">
                A/B tests break silently.
                <br />
                <span className="text-fg-secondary">The Doctor finds out why.</span>
              </h2>
              <p id="welcome-body" className="mt-3 text-[14px] leading-[1.6] text-fg-secondary">
                One wrong line of code and Flagsmith stops counting your results, with no error anywhere. Experiment Doctor
                finds the cause, fixes it with your OK and proves the fix worked.
              </p>
              <p className="mt-5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-fg-muted">What do you want to do?</p>
            </div>

            <ul className="relative space-y-2 px-4 pb-4 sm:px-5 sm:pb-5">
              {PATHS.map((p, n) => (
                <motion.li
                  key={p.href}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: reduce ? 0 : 0.35, ease: ease.smooth, delay: reduce ? 0 : 0.12 + n * 0.05 }}
                >
                  <Link
                    href={p.href}
                    onClick={close}
                    autoFocus={p.primary}
                    className={
                      "group flex items-center gap-4 rounded-[12px] border px-4 py-3.5 transition-[border-color,background-color,transform] duration-150 hover:-translate-y-px " +
                      (p.primary
                        ? "border-accent/50 bg-accent/[0.10] hover:border-accent hover:bg-accent/[0.16]"
                        : "border-border bg-canvas/50 hover:border-border-strong hover:bg-elevated")
                    }
                  >
                    <span
                      className={
                        "flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border " +
                        (p.primary ? "border-accent/50 bg-accent text-white" : "border-border bg-elevated text-fg-secondary group-hover:text-fg")
                      }
                    >
                      {p.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="text-[14.5px] font-medium text-fg">{p.title}</span>
                        {p.primary && (
                          <span className="rounded-full bg-accent/25 px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.1em] text-[#c4b0ff]">
                            Start here
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block text-[12.5px] leading-[1.45] text-fg-muted">{p.body}</span>
                    </span>
                    <span className="hidden shrink-0 font-mono text-[10.5px] uppercase tracking-[0.1em] text-fg-muted sm:block">{p.meta}</span>
                    <span aria-hidden className="shrink-0 text-fg-muted transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-fg">
                      →
                    </span>
                  </Link>
                </motion.li>
              ))}
            </ul>

            <div className="relative flex items-center justify-between border-t border-border px-6 py-3.5 sm:px-7">
              <p className="text-[12px] text-fg-muted">Open source · nothing to install for the website</p>
              <button type="button" onClick={close} className="text-[13px] text-fg-secondary transition-colors hover:text-fg">
                Just look around
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
