import { getCase } from "@/lib/game/cases";
import type { ReceiptPayload, SessionPayload } from "@/lib/game/types";
import { verifyRepair } from "@/lib/game/verify";
import { getStore } from "@/lib/server/store";
import { shareCode } from "@/lib/server/share";
import { sign, unsign } from "@/lib/server/token";
import { bad, readJson } from "@/lib/server/validate";
import { CHALLENGE_LIMIT_MS } from "@/lib/site";

/**
 * Verifies a repair on the server. Elapsed time is measured from the signed start time.
 * Only the pipeline stage that is still broken is returned on failure, not the checklist,
 * so the verify button is not a free hint.
 */
export async function POST(request: Request) {
  const body = await readJson(request, 32_768);
  const session = unsign<SessionPayload>(body?.token);
  if (!session || session.kind !== "session") return bad("Invalid session.", 401);
  if (typeof body?.code !== "string") return bad("code is required.");

  const game = getCase(session.caseId);
  if (!game) return bad("Unknown case.");

  const elapsedMs = Date.now() - session.t0;
  const result = verifyRepair(body.code, { flag: game.config.flag, metric: game.config.metric });
  const store = getStore();
  const firstFailing = result.checks.find((c) => !c.ok);
  const firstSuccess = await store.recordAttempt(session.sid, {
    ok: result.ok,
    elapsedMs,
    failingCheck: firstFailing?.id ?? null,
  });

  if (!result.ok) {
    return Response.json({
      ok: false,
      elapsedMs,
      brokenStage: result.brokenStage,
      syntaxError: firstFailing?.id === "parse" ? firstFailing.detail : undefined,
    });
  }

  const row = await store.getSession(session.sid);
  const recordedMs = row?.elapsed_ms ?? elapsedMs;
  const withinLimit = recordedMs <= CHALLENGE_LIMIT_MS;
  const receipt: ReceiptPayload = {
    kind: "receipt",
    sid: session.sid,
    caseId: session.caseId,
    variant: session.variant,
    elapsedMs: recordedMs,
    usedHint: Boolean(row?.hint_at),
    counted: session.counted,
  };

  return Response.json({
    ok: true,
    elapsedMs: recordedMs,
    withinLimit,
    firstSuccess,
    // Leaderboard spots are for counted runs repaired inside the time limit.
    receipt: withinLimit && session.counted ? sign(receipt) : null,
    // Share links carry the verified time, signed so a card cannot claim a time nobody earned.
    share: withinLimit ? shareCode(recordedMs, session.caseId) : null,
  });
}
