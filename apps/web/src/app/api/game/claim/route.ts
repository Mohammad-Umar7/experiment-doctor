import type { ReceiptPayload } from "@/lib/game/types";
import { getStore } from "@/lib/server/store";
import { unsign } from "@/lib/server/token";
import { bad, cleanHandle, readJson } from "@/lib/server/validate";

/** Exchanges a signed repair receipt and a handle for a leaderboard entry. One per session. */
export async function POST(request: Request) {
  const body = await readJson(request);
  const receipt = unsign<ReceiptPayload>(body?.receipt);
  if (!receipt || receipt.kind !== "receipt") return bad("Invalid receipt.", 401);
  const handle = cleanHandle(body?.handle);
  if (!handle) return bad("Handle must be 2 to 20 letters, numbers, dots, dashes or underscores.");

  await getStore().claim({
    sid: receipt.sid,
    handle,
    caseId: receipt.caseId,
    elapsedMs: receipt.elapsedMs,
    variant: receipt.variant,
    usedHint: receipt.usedHint,
  });
  return Response.json({ ok: true, handle });
}
