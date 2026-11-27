import { Hero } from "@/components/landing/hero";
import { HowItWorks } from "@/components/landing/how-it-works";
import { FailureCatalog } from "@/components/landing/failure-catalog";
import { ChallengeTeaser } from "@/components/landing/challenge-teaser";
import { Install } from "@/components/landing/install";

export default function Home() {
  return (
    <>
      <Hero />
      <HowItWorks />
      <ChallengeTeaser />
      <FailureCatalog />
      <Install />
    </>
  );
}
