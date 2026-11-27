import { connection } from "next/server";
import { computeStats, getStore } from "@/lib/server/store";

export async function GET() {
  await connection();
  const store = getStore();
  const stats = computeStats(await store.sessions());
  return Response.json(
    { ...stats, storage: store.kind },
    { headers: { "Cache-Control": "public, s-maxage=10, stale-while-revalidate=60" } },
  );
}
