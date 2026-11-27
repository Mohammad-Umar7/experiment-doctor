import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getCase } from "@/lib/game/cases";

/**
 * Share links carry a verified time: /s/<ms>-<case>-<sig>. The signature is a truncated HMAC
 * with the session secret, so a share card can only show a time the server actually verified.
 */
function secret(): string {
  const value = process.env.SESSION_SECRET;
  return value && value.length >= 16 ? value : "dev-only-session-secret-change-me";
}

function sig(ms: number, caseId: string): string {
  return createHmac("sha256", secret()).update(`share:${ms}:${caseId}`).digest("base64url").slice(0, 12);
}

export function shareCode(ms: number, caseId: string): string {
  return `${Math.round(ms)}-${caseId}-${sig(Math.round(ms), caseId)}`;
}

export function readShareCode(code: string): { ms: number; caseId: string; caseTitle: string } | null {
  const match = /^(\d{1,7})-(\d{3})-([A-Za-z0-9_-]{12})$/.exec(code);
  if (!match) return null;
  const ms = Number(match[1]);
  const caseId = match[2];
  const game = getCase(caseId);
  if (!game) return null;
  const a = Buffer.from(match[3]);
  const b = Buffer.from(sig(ms, caseId));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return { ms, caseId, caseTitle: game.title };
}
