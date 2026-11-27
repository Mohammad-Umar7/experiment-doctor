import { randomUUID } from "node:crypto";
import { CASES, getCase } from "@/lib/game/cases";
import type { AssignmentSource, SessionPayload } from "@/lib/game/types";
import { getStore } from "@/lib/server/store";
import { sign } from "@/lib/server/token";
import { bad, isId, isVariant, readJson } from "@/lib/server/validate";

/**
 * Starts a challenge. The server stamps the start time into a signed token, so the
 * clock is authoritative. The hint style comes from the client's Flagsmith assignment.
 */
export async function POST(request: Request) {
  const body = await readJson(request);
  if (!body) return bad("Invalid JSON body.");

  const { playerId, variant, source, caseId, practice } = body;
  if (!isId(playerId)) return bad("playerId must be 8 to 64 characters of [A-Za-z0-9_-].");
  if (!isVariant(variant)) return bad("Unknown hint variant.");

  const chosen = typeof caseId === "string" ? getCase(caseId) : CASES[Math.floor(Math.random() * CASES.length)];
  if (!chosen) return bad("Unknown case.");

  const assignment: AssignmentSource = source === "flagsmith" ? "flagsmith" : "local";
  const payload: SessionPayload = {
    kind: "session",
    sid: randomUUID(),
    pid: playerId,
    caseId: chosen.id,
    variant,
    source: assignment,
    counted: practice !== true,
    t0: Date.now(),
  };

  await getStore().startSession({
    sid: payload.sid,
    pid: payload.pid,
    case_id: payload.caseId,
    variant: payload.variant,
    source: payload.source,
    counted: payload.counted,
    started_at: new Date(payload.t0).toISOString(),
  });

  return Response.json({ token: sign(payload), caseId: chosen.id, startedAt: payload.t0, counted: payload.counted });
}
