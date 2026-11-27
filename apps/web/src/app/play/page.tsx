import type { Metadata } from "next";
import { PlayClient } from "@/components/game/play-client";

export const metadata: Metadata = {
  title: "Human vs Doctor",
  description: "Fix a broken Flagsmith experiment in under three minutes. The AI Doctor did it in twelve seconds.",
};

export default function PlayPage() {
  return <PlayClient />;
}
