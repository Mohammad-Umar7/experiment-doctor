import "server-only";
import { CHALLENGE_LIMIT_MS, HINT_VARIANTS, type HintVariant } from "@/lib/site";
import type { GameStats, LeaderboardEntry, VariantStats } from "@/lib/game/types";

/**
 * Game storage. Uses Supabase when SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are set;
 * otherwise an in-process memory store that is fine for local development.
 * Schema: supabase/schema.sql.
 */

export type SessionRow = {
  sid: string;
  pid: string;
  case_id: string;
  variant: HintVariant;
  source: string;
  counted: boolean;
  started_at: string;
  hint_at: string | null;
  repaired_at: string | null;
  elapsed_ms: number | null;
  attempts: number;
  last_failing_check: string | null;
};

export interface Store {
  readonly kind: "supabase" | "memory";
  startSession(row: Omit<SessionRow, "hint_at" | "repaired_at" | "elapsed_ms" | "attempts" | "last_failing_check">): Promise<void>;
  recordHint(sid: string): Promise<void>;
  /** Returns true when this is the session's first verified repair. */
  recordAttempt(sid: string, result: { ok: boolean; elapsedMs: number; failingCheck: string | null }): Promise<boolean>;
  getSession(sid: string): Promise<SessionRow | null>;
  claim(entry: Omit<LeaderboardEntry, "createdAt">): Promise<void>;
  leaderboard(limit: number): Promise<LeaderboardEntry[]>;
  sessions(): Promise<SessionRow[]>;
}

/* ----------------------------- memory ----------------------------- */

type Memory = { sessions: Map<string, SessionRow>; board: Map<string, LeaderboardEntry> };

const g = globalThis as unknown as { __doctorMemory?: Memory };
const mem: Memory = (g.__doctorMemory ??= { sessions: new Map(), board: new Map() });

const memoryStore: Store = {
  kind: "memory",
  async startSession(row) {
    mem.sessions.set(row.sid, { ...row, hint_at: null, repaired_at: null, elapsed_ms: null, attempts: 0, last_failing_check: null });
  },
  async recordHint(sid) {
    const s = mem.sessions.get(sid);
    if (s && !s.hint_at) s.hint_at = new Date().toISOString();
  },
  async recordAttempt(sid, result) {
    const s = mem.sessions.get(sid);
    if (!s) return false;
    s.attempts += 1;
    if (!result.ok) {
      s.last_failing_check = result.failingCheck;
      return false;
    }
    if (s.repaired_at) return false;
    s.repaired_at = new Date().toISOString();
    s.elapsed_ms = result.elapsedMs;
    return true;
  },
  async getSession(sid) {
    return mem.sessions.get(sid) ?? null;
  },
  async claim(entry) {
    if (!mem.board.has(entry.sid)) mem.board.set(entry.sid, { ...entry, createdAt: new Date().toISOString() });
  },
  async leaderboard(limit) {
    return [...mem.board.values()].sort((a, b) => a.elapsedMs - b.elapsedMs).slice(0, limit);
  },
  async sessions() {
    return [...mem.sessions.values()];
  },
};

/* ----------------------------- supabase ----------------------------- */

type LeaderboardRow = {
  sid: string;
  handle: string;
  case_id: string;
  elapsed_ms: number;
  variant: HintVariant;
  used_hint: boolean;
  created_at: string;
};

/**
 * Talks to Supabase only through the security-definer functions in supabase/schema.sql.
 * Tables have no grants, so the publishable key is enough and no secret key is needed.
 */
function supabaseStore(url: string, key: string): Store {
  const base = `${url.replace(/\/$/, "")}/rest/v1/rpc`;
  const headers: Record<string, string> = { apikey: key, "Content-Type": "application/json" };
  // Legacy JWT keys also go in Authorization; new sb_ keys must not.
  if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;

  async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    const res = await fetch(`${base}/${fn}`, {
      method: "POST",
      headers,
      body: JSON.stringify(args),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Supabase ${fn} ${res.status}: ${await res.text()}`);
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  }

  return {
    kind: "supabase",
    async startSession(row) {
      await rpc("doctor_start_session", {
        p_sid: row.sid,
        p_pid: row.pid,
        p_case_id: row.case_id,
        p_variant: row.variant,
        p_source: row.source,
        p_counted: row.counted,
        p_started_at: row.started_at,
      });
    },
    async recordHint(sid) {
      await rpc("doctor_record_hint", { p_sid: sid });
    },
    async recordAttempt(sid, result) {
      const first = await rpc<boolean>("doctor_record_attempt", {
        p_sid: sid,
        p_ok: result.ok,
        p_elapsed_ms: result.elapsedMs,
        p_failing_check: result.failingCheck,
      });
      return first === true;
    },
    async getSession(sid) {
      const rows = await rpc<SessionRow[]>("doctor_get_session", { p_sid: sid });
      return rows?.[0] ?? null;
    },
    async claim(entry) {
      await rpc<boolean>("doctor_claim", {
        p_sid: entry.sid,
        p_handle: entry.handle,
        p_case_id: entry.caseId,
        p_elapsed_ms: entry.elapsedMs,
        p_variant: entry.variant,
        p_used_hint: entry.usedHint,
      });
    },
    async leaderboard(limit) {
      const rows = await rpc<LeaderboardRow[]>("doctor_leaderboard_top", { p_limit: limit });
      return (rows ?? []).map((r) => ({
        sid: r.sid,
        handle: r.handle,
        caseId: r.case_id,
        elapsedMs: r.elapsed_ms,
        variant: r.variant,
        usedHint: r.used_hint,
        createdAt: r.created_at,
      }));
    },
    async sessions() {
      return (await rpc<SessionRow[]>("doctor_all_sessions")) ?? [];
    },
  };
}

let cached: Store | null = null;

export function getStore(): Store {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  cached = url && key ? supabaseStore(url, key) : memoryStore;
  return cached;
}

/* ----------------------------- stats ----------------------------- */

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** Aggregate counted sessions into the numbers the Rescue Center shows. */
export function computeStats(rows: SessionRow[]): GameStats {
  const counted = rows.filter((r) => r.counted);
  const empty = (): VariantStats => ({ enrolled: 0, hinted: 0, repaired: 0, medianMs: null });
  const byVariant = { [HINT_VARIANTS.control]: empty(), [HINT_VARIANTS.challenger]: empty() } as Record<HintVariant, VariantStats>;
  const times: Record<HintVariant, number[]> = { [HINT_VARIANTS.control]: [], [HINT_VARIANTS.challenger]: [] } as Record<
    HintVariant,
    number[]
  >;
  const byCase: GameStats["byCase"] = {};
  const failingChecks: Record<string, number> = {};

  // The experiment unit is a player: only each player's first counted run feeds the A/B
  // numbers, so replays cannot tilt a variant. Every counted run still feeds byCase.
  const firstRun = new Map<string, SessionRow>();
  for (const r of counted) {
    const prev = firstRun.get(r.pid);
    if (!prev || r.started_at < prev.started_at) firstRun.set(r.pid, r);
  }

  for (const r of counted) {
    byCase[r.case_id] ??= { started: 0, repaired: 0 };
    byCase[r.case_id].started += 1;
    if (r.elapsed_ms !== null && r.elapsed_ms <= CHALLENGE_LIMIT_MS) byCase[r.case_id].repaired += 1;
    if (r.last_failing_check) failingChecks[r.last_failing_check] = (failingChecks[r.last_failing_check] ?? 0) + 1;
  }

  const fromFlagsmith = {
    [HINT_VARIANTS.control]: { enrolled: 0, repaired: 0 },
    [HINT_VARIANTS.challenger]: { enrolled: 0, repaired: 0 },
  } as GameStats["fromFlagsmith"];

  for (const r of firstRun.values()) {
    if (r.source === "flagsmith" && fromFlagsmith[r.variant]) {
      fromFlagsmith[r.variant].enrolled += 1;
      if (r.elapsed_ms !== null && r.elapsed_ms <= CHALLENGE_LIMIT_MS) fromFlagsmith[r.variant].repaired += 1;
    }
    const v = byVariant[r.variant];
    if (!v) continue;
    v.enrolled += 1;
    if (r.hint_at) v.hinted += 1;
    const repairedInTime = r.elapsed_ms !== null && r.elapsed_ms <= CHALLENGE_LIMIT_MS;
    if (repairedInTime) {
      v.repaired += 1;
      times[r.variant].push(r.elapsed_ms as number);
    }
  }
  for (const key of Object.keys(byVariant) as HintVariant[]) byVariant[key].medianMs = median(times[key]);

  return {
    players: firstRun.size,
    sessions: counted.length,
    verifiedRepairs: Object.values(byVariant).reduce((n, v) => n + v.repaired, 0),
    byVariant,
    fromFlagsmith,
    byCase,
    failingChecks,
    updatedAt: new Date().toISOString(),
  };
}
