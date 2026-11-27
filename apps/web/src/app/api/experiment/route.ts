import { connection } from "next/server";
import { getExperimentResults } from "@/lib/server/flagsmith-results";

export async function GET() {
  await connection();
  const results = await getExperimentResults();
  return Response.json(results, { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" } });
}
