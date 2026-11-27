import type { Metadata } from "next";
import { PlayClient } from "@/components/game/play-client";

export const metadata: Metadata = {
  title: "Human vs Doctor",
  description: "Fix a broken Flagsmith experiment in under three minutes. Race an AI Doctor whose times are measured, not made up.",
};

export default function PlayPage() {
  return <PlayClient />;
}
