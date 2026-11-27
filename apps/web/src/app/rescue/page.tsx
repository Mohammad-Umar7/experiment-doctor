import type { Metadata } from "next";
import { RescueClient } from "@/components/rescue/rescue-client";

export const metadata: Metadata = {
  title: "Rescue Center",
  description: "Live results of the Human vs Doctor Flagsmith experiment: which hint style gets more people to a verified repair.",
};

export default function RescuePage() {
  return <RescueClient />;
}
