import type { SessionPayload } from "@/lib/game/types";
import { getStore } from "@/lib/server/store";
import { unsign } from "@/lib/server/token";
import { bad, readJson } from "@/lib/server/validate";

/** Records that the player opened the hint. Used to report hint usage per variant. */
export async function POST(request: Request) {
  const body = await readJson(request);
  const session = unsign<SessionPayload>(body?.token);
  if (!session || session.kind !== "session") return bad("Invalid session.", 401);
  await getStore().recordHint(session.sid);
  return Response.json({ ok: true });
}
