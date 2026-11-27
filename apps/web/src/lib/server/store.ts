import "server-only";
import { CHALLENGE_LIMIT_MS, HINT_VARIANTS, type HintVariant } from "@/lib/site";
import type { GameStats, LeaderboardEntry, VariantStats } from "@/lib/game/types";

/**
 * Game storage. Uses Supabase (PostgREST) when SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
 * are set; otherwise an in-process memory store that is fine for local development.
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

function supabaseStore(url: string, key: string): Store {
  const base = `${url.replace(/\/$/, "")}/rest/v1`;
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };

  async function req(path: string, init?: RequestInit) {
    const res = await fetch(`${base}${path}`, { ...init, headers: { ...headers, ...(init?.headers ?? {}) }, cache: "no-store" });
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  return {
    kind: "supabase",
    async startSession(row) {
      await req("/doctor_sessions", { method: "POST", body: JSON.stringify(row), headers: { Prefer: "return=minimal" } });
    },
    async recordHint(sid) {
      await req(`/doctor_sessions?sid=eq.${encodeURIComponent(sid)}&hint_at=is.null`, {
        method: "PATCH",
        body: JSON.stringify({ hint_at: new Date().toISOString() }),
        headers: { Prefer: "return=minimal" },
      });
    },
    async recordAttempt(sid, result) {
      const rows = (await req("/rpc/doctor_record_attempt", {
        method: "POST",
        body: JSON.stringify({
          p_sid: sid,
          p_ok: result.ok,
          p_elapsed_ms: result.elapsedMs,
          p_failing_check: result.failingCheck,
        }),
      })) as boolean | null;
      return rows === true;
    },
    async getSession(sid) {
      const rows = (await req(`/doctor_sessions?sid=eq.${encodeURIComponent(sid)}&limit=1`)) as SessionRow[];
      return rows[0] ?? null;
    },
    async claim(entry) {
      await req("/doctor_leaderboard", {
        method: "POST",
        body: JSON.stringify({
          sid: entry.sid,
          handle: entry.handle,
          case_id: entry.caseId,
          elapsed_ms: entry.elapsedMs,
          variant: entry.variant,
          used_hint: entry.usedHint,
        }),
        headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      });
    },
    async leaderboard(limit) {
      const rows = (await req(`/doctor_leaderboard?select=*&order=elapsed_ms.asc&limit=${limit}`)) as Array<{
        sid: string;
        handle: string;
        case_id: string;
        elapsed_ms: number;
        variant: HintVariant;
        used_hint: boolean;
        created_at: string;
      }>;
      return rows.map((r) => ({
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
      return (await req("/doctor_sessions?select=*&order=started_at.asc&limit=10000")) as SessionRow[];
    },
  };
}

let cached: Store | null = null;

export function getStore(): Store {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
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

  for (const r of counted) {
    const v = byVariant[r.variant];
    if (!v) continue;
    v.enrolled += 1;
    if (r.hint_at) v.hinted += 1;
    const repairedInTime = r.elapsed_ms !== null && r.elapsed_ms <= CHALLENGE_LIMIT_MS;
    if (repairedInTime) {
      v.repaired += 1;
      times[r.variant].push(r.elapsed_ms as number);
    }
    byCase[r.case_id] ??= { started: 0, repaired: 0 };
    byCase[r.case_id].started += 1;
    if (repairedInTime) byCase[r.case_id].repaired += 1;
    if (r.last_failing_check) failingChecks[r.last_failing_check] = (failingChecks[r.last_failing_check] ?? 0) + 1;
  }
  for (const key of Object.keys(byVariant) as HintVariant[]) byVariant[key].medianMs = median(times[key]);

  return {
    players: new Set(counted.map((r) => r.pid)).size,
    sessions: counted.length,
    verifiedRepairs: Object.values(byVariant).reduce((n, v) => n + v.repaired, 0),
    byVariant,
    byCase,
    failingChecks,
    updatedAt: new Date().toISOString(),
  };
}
