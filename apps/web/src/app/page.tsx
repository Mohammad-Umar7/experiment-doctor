import { Hero } from "@/components/landing/hero";
import { HowItWorks } from "@/components/landing/how-it-works";
import { FailureCatalog } from "@/components/landing/failure-catalog";
import { ChallengeTeaser } from "@/components/landing/challenge-teaser";
import { Install } from "@/components/landing/install";
import { CiGate } from "@/components/landing/ci-gate";
import { LabProof } from "@/components/landing/lab-proof";

export default function Home() {
  return (
    <>
      <Hero />
      <HowItWorks />
      <CiGate />
      <LabProof />
      <ChallengeTeaser />
      <FailureCatalog />
      <Install />
    </>
  );
}
