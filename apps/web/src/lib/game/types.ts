import type { HintVariant } from "@/lib/site";

/** Where the hint style came from: the live Flagsmith experiment, or a local fallback. */
export type AssignmentSource = "flagsmith" | "local";

/** Signed into the session token when a challenge starts. */
export type SessionPayload = {
  kind: "session";
  sid: string;
  pid: string;
  caseId: string;
  variant: HintVariant;
  source: AssignmentSource;
  /** Counted runs feed the experiment; practice runs never do. */
  counted: boolean;
  t0: number;
};

/** Signed proof of a verified repair, exchanged for a leaderboard spot. */
export type ReceiptPayload = {
  kind: "receipt";
  sid: string;
  caseId: string;
  variant: HintVariant;
  elapsedMs: number;
  usedHint: boolean;
  counted: boolean;
};

export type LeaderboardEntry = {
  sid: string;
  handle: string;
  caseId: string;
  elapsedMs: number;
  variant: HintVariant;
  usedHint: boolean;
  createdAt: string;
};

export type VariantStats = {
  /** Counted sessions assigned to this variant (intention to treat). */
  enrolled: number;
  /** Of those, sessions that requested a hint. */
  hinted: number;
  /** Verified repairs within the time limit. */
  repaired: number;
  /** Median repair time in ms, null when no repairs yet. */
  medianMs: number | null;
};

export type GameStats = {
  players: number;
  sessions: number;
  verifiedRepairs: number;
  byVariant: Record<HintVariant, VariantStats>;
  byCase: Record<string, { started: number; repaired: number }>;
  /** Which check failed most on wrong attempts. */
  failingChecks: Record<string, number>;
  updatedAt: string;
};
