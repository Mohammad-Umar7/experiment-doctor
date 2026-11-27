"use client";

import { useEffect, useState } from "react";
import { useReducedMotion } from "motion/react";

export type ResurrectionStep = {
  /** 0ms: the failed stage turns green. */
  nodeFixed: boolean;
  /** 700ms: the flatline produces its first heartbeat. */
  heartbeat: boolean;
  /** 1000ms: "EXPERIMENT REVIVED" fades in. */
  banner: boolean;
  /** 1400ms: the verified result and share card appear. */
  done: boolean;
};

const DEAD: ResurrectionStep = { nodeFixed: false, heartbeat: false, banner: false, done: false };
const ALIVE: ResurrectionStep = { nodeFixed: true, heartbeat: true, banner: true, done: true };

/**
 * The 1400ms resurrection choreography from docs/design.md.
 * Only call with `revived = true` after the backend confirmed the repair.
 */
export function useResurrection(revived: boolean, onDone?: () => void): ResurrectionStep {
  const reduce = useReducedMotion();
  const [step, setStep] = useState<ResurrectionStep>(revived ? ALIVE : DEAD);

  useEffect(() => {
    if (!revived) {
      setStep(DEAD);
      return;
    }
    if (reduce) {
      setStep(ALIVE);
      onDone?.();
      return;
    }
    setStep({ ...DEAD, nodeFixed: true });
    const timers = [
      setTimeout(() => setStep((s) => ({ ...s, heartbeat: true })), 700),
      setTimeout(() => setStep((s) => ({ ...s, banner: true })), 1000),
      setTimeout(() => {
        setStep(ALIVE);
        onDone?.();
      }, 1400),
    ];
    return () => timers.forEach(clearTimeout);
    // onDone is intentionally not a dependency: it should not restart the sequence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revived, reduce]);

  return step;
}
