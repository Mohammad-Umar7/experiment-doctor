import { connection } from "next/server";
import { getStore } from "@/lib/server/store";

export async function GET() {
  await connection();
  const entries = await getStore().leaderboard(50);
  return Response.json({ entries }, { headers: { "Cache-Control": "public, s-maxage=5, stale-while-revalidate=30" } });
}
