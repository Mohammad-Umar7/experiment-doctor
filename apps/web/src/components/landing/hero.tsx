import { VitalsMonitor } from "@/components/vitals-monitor";
import { ButtonLink } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";

/** 450ms rise, staggered by 60ms per block. Pure CSS so it runs even when JS is busy or throttled. */
const rise = (i: number) => ({ className: "animate-rise", style: { animationDelay: `${i * 60}ms` } });

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* single soft purple glow, kept far behind the content */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[-280px] h-[560px] w-[900px] -translate-x-1/2 rounded-full bg-accent/[0.10] blur-[120px]"
      />
      <div className="relative mx-auto max-w-[1280px] px-4 pb-16 pt-14 sm:px-6 sm:pt-20">
        <div className="mx-auto max-w-[820px] text-center">
          <div {...rise(0)}>
            <div className="flex justify-center">
              <StatusPill status="accent">Built for Flagsmith Experimentation</StatusPill>
            </div>
          </div>
          <h1
            {...rise(1)}
            className="animate-rise mt-6 text-balance text-[40px] font-semibold leading-[1.02] tracking-[-0.045em] sm:text-[64px]"
          >
            Your experiment is flatlining.
            <br />
            <span className="text-fg-secondary">Find out why.</span>
          </h1>
          <p
            {...rise(2)}
            className="animate-rise mx-auto mt-5 max-w-[560px] text-pretty text-[15px] leading-[1.6] text-fg-secondary sm:text-base"
          >
            Diagnose broken A/B tests with evidence, not guesses. Repair them with one approved patch. Block the next one in CI.
            Then race the AI doctor at fixing one.
          </p>
          <div {...rise(3)}>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <ButtonLink href="/play" size="lg">
                Challenge the Doctor
                <span aria-hidden>→</span>
              </ButtonLink>
              <ButtonLink href="#install" size="lg" variant="secondary">
                Run it on your experiment
              </ButtonLink>
            </div>
          </div>
          <p {...rise(4)} className="animate-rise mt-4 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-muted">
            No account needed · 3-minute challenge
          </p>
        </div>

        <div {...rise(5)}>
          <div className="mx-auto mt-12 max-w-[920px]">
            <VitalsMonitor />
            <p className="mt-3 text-center font-mono text-[11px] text-fg-muted">
              Simulated demonstration of a real failure: a metric that expects <span className="text-fg-secondary">purchase</span>{" "}
              receiving <span className="text-fg-secondary">Purchase</span>.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
