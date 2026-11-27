"use client";

/**
 * Flagsmith wiring for the Human vs Doctor experiment.
 *
 * We follow our own Doctor's rules: init with enableEvents, identify before reading the
 * experiment flag, read it with getExperimentFlag at the moment the player starts (that is
 * the exposure), send the exact metric event name, and flush before the page goes away.
 *
 * Without NEXT_PUBLIC_FLAGSMITH_ENVIRONMENT_ID the game still works and falls back to a
 * deterministic local split, clearly marked as "local" in the stats.
 */
import flagsmith from "@flagsmith/flagsmith";
import { EXPERIMENT_EVENT, EXPERIMENT_FLAG, HINT_VARIANTS, type HintVariant } from "@/lib/site";
import type { AssignmentSource } from "@/lib/game/types";

const ENVIRONMENT_ID = process.env.NEXT_PUBLIC_FLAGSMITH_ENVIRONMENT_ID;
const API_URL = process.env.NEXT_PUBLIC_FLAGSMITH_API_URL;
const EVENTS_URL = process.env.NEXT_PUBLIC_FLAGSMITH_EVENTS_URL;
const PID_KEY = "experiment-doctor.pid";

export const flagsmithConfigured = Boolean(ENVIRONMENT_ID);

let ready: Promise<boolean> | null = null;

/** Stable anonymous player id, kept in localStorage. */
export function getPlayerId(): string {
  try {
    const existing = localStorage.getItem(PID_KEY);
    if (existing && /^[A-Za-z0-9_-]{8,64}$/.test(existing)) return existing;
    const id = `p_${crypto.randomUUID().replace(/-/g, "")}`;
    localStorage.setItem(PID_KEY, id);
    return id;
  } catch {
    return `p_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  }
}

function localVariant(pid: string): HintVariant {
  let h = 0;
  for (let i = 0; i < pid.length; i++) h = (h * 31 + pid.charCodeAt(i)) | 0;
  return Math.abs(h) % 2 === 0 ? HINT_VARIANTS.control : HINT_VARIANTS.challenger;
}

/** Initialise and identify early so the exposure on Start is instant. Safe to call repeatedly. */
export function prepare(pid: string): Promise<boolean> {
  if (!ENVIRONMENT_ID) return Promise.resolve(false);
  ready ??= (async () => {
    try {
      await flagsmith.init({
        environmentID: ENVIRONMENT_ID,
        enableEvents: true,
        ...(API_URL ? { api: API_URL } : {}),
        ...(EVENTS_URL ? { eventProcessorConfig: { eventsApiUrl: EVENTS_URL } } : {}),
      });
      await flagsmith.identify(pid);
      window.addEventListener("pagehide", () => {
        void flagsmith.flushEvents();
      });
      return true;
    } catch {
      return false;
    }
  })();
  return ready;
}

/**
 * Reads the experiment flag. This records the exposure, so call it exactly when the
 * player starts a counted challenge, never for practice runs.
 */
export async function expose(pid: string): Promise<{ variant: HintVariant; source: AssignmentSource }> {
  const ok = await prepare(pid);
  if (!ok) return { variant: localVariant(pid), source: "local" };
  const flag = flagsmith.getExperimentFlag(EXPERIMENT_FLAG);
  const value = flag?.value;
  if (value === HINT_VARIANTS.challenger || value === HINT_VARIANTS.control) {
    return { variant: value, source: "flagsmith" };
  }
  // Flag missing or experiment not running: everyone gets the control experience.
  return { variant: HINT_VARIANTS.control, source: "flagsmith" };
}

/** Variant for a practice run, without recording an exposure. */
export function practiceVariant(pid: string): HintVariant {
  return localVariant(pid);
}

/** The conversion: a server-verified repair inside the time limit. */
export async function trackVerifiedRepair(elapsedMs: number) {
  if (!ENVIRONMENT_ID || !(await prepare(getPlayerId()))) return;
  flagsmith.trackEvent(EXPERIMENT_EVENT, { value: Math.round(elapsedMs / 1000) });
  await flagsmith.flushEvents();
}

/** Secondary signal: the player opened their hint. */
export async function trackHintOpened() {
  if (!ENVIRONMENT_ID || !(await prepare(getPlayerId()))) return;
  flagsmith.trackEvent("hint_opened");
}
