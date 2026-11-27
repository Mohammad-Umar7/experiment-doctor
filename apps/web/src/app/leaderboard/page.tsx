import type { Metadata } from "next";
import { LeaderboardClient } from "@/components/leaderboard/leaderboard-client";

export const metadata: Metadata = {
  title: "Leaderboard",
  description: "The fastest verified repairs of broken Flagsmith experiments, and the AI benchmark to beat.",
};

export default function LeaderboardPage() {
  return <LeaderboardClient />;
}
