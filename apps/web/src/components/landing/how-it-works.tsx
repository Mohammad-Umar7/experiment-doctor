import { Reveal } from "@/components/reveal";
import { Eyebrow } from "@/components/ui/panel";

const STEPS = [
  {
    n: "01",
    title: "Diagnose, read-only",
    body: "The Doctor reads your experiment, flag, metrics and warehouse through the official Flagsmith CLI, and scans your code for the SDK calls. Nothing is changed.",
    proof: "flagsmith api …/experiments/ --json",
  },
  {
    n: "02",
    title: "One patch, your approval",
    body: "You get the single most likely cause with the evidence behind it and the exact diff. Nothing is written until you say yes. Production needs an extra flag.",
    proof: '- trackEvent("Purchase")  + trackEvent("purchase")',
  },
  {
    n: "03",
    title: "Verified, or honestly pending",
    body: "After the fix, the Doctor checks that exposure and conversion join for the same identity. Slow processing reads PENDING, never a fake green check.",
    proof: "VERIFIED · FAILED · PENDING",
  },
];

export function HowItWorks() {
  return (
    <section className="border-t border-border">
      <div className="mx-auto max-w-[1280px] px-4 py-20 sm:px-6 sm:py-24">
        <Reveal className="max-w-[640px]">
          <Eyebrow>How the Doctor works</Eyebrow>
          <h2 className="mt-3 text-[28px] font-semibold tracking-[-0.03em] sm:text-[32px]">
            Every green check is backed by evidence.
          </h2>
          <p className="mt-3 text-[15px] leading-[1.6] text-fg-secondary">
            A broken experiment fails silently: SDKs skip events instead of throwing. The Doctor follows an event from your
            app to the results and tells you exactly where it disappears.
          </p>
        </Reveal>

        <ol className="mt-12 grid grid-cols-1 gap-px overflow-hidden rounded-[var(--radius-card)] border border-border bg-border md:grid-cols-3">
          {STEPS.map((step, i) => (
            <Reveal as="li" key={step.n} delay={i * 0.06} className="flex min-w-0 flex-col bg-surface p-6">
              <span className="font-mono text-[12px] text-accent">{step.n}</span>
              <h3 className="mt-3 text-base font-semibold">{step.title}</h3>
              <p className="mt-2 flex-1 text-[14px] leading-[1.6] text-fg-secondary">{step.body}</p>
              <code className="mt-5 block truncate rounded-md border border-border bg-canvas px-3 py-2 font-mono text-[12px] text-fg-secondary">
                {step.proof}
              </code>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}
