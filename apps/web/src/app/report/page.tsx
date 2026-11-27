import type { Metadata } from "next";
import { WebDoctor } from "@/components/doctor/web-doctor";

export const metadata: Metadata = {
  title: "Doctor report",
  description: "Run the Experiment Doctor in your browser on code that talks to Flagsmith, or open a report saved by the CLI.",
};

export default function ReportPage() {
  return <WebDoctor />;
}
