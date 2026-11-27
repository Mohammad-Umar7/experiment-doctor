"use client";

import { motion } from "motion/react";
import { VitalsMonitor } from "@/components/vitals-monitor";
import { ButtonLink } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { rise } from "@/lib/motion";

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* single soft purple glow, kept far behind the content */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[-280px] h-[560px] w-[900px] -translate-x-1/2 rounded-full bg-accent/[0.10] blur-[120px]"
      />
      <div className="relative mx-auto max-w-[1280px] px-4 pb-16 pt-14 sm:px-6 sm:pt-20">
        <motion.div initial="hidden" animate="show" className="mx-auto max-w-[820px] text-center">
          <motion.div variants={rise} custom={0} className="flex justify-center">
            <StatusPill status="accent">Built for Flagsmith Experimentation</StatusPill>
          </motion.div>
          <motion.h1
            variants={rise}
            custom={1}
            className="mt-6 text-balance text-[40px] font-semibold leading-[1.02] tracking-[-0.045em] sm:text-[64px]"
          >
            Your experiment is flatlining.
            <br />
            <span className="text-fg-secondary">Find out why.</span>
          </motion.h1>
          <motion.p
            variants={rise}
            custom={2}
            className="mx-auto mt-5 max-w-[560px] text-pretty text-[15px] leading-[1.6] text-fg-secondary sm:text-base"
          >
            Diagnose broken A/B tests with evidence, not guesses. Repair them with one approved patch. Then race the AI
            doctor that does it in twelve seconds.
          </motion.p>
          <motion.div variants={rise} custom={3} className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <ButtonLink href="/play" size="lg">
              Challenge the Doctor
              <span aria-hidden>→</span>
            </ButtonLink>
            <ButtonLink href="#install" size="lg" variant="secondary">
              Run it on your experiment
            </ButtonLink>
          </motion.div>
          <motion.p variants={rise} custom={4} className="mt-4 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-muted">
            No account needed · 3-minute challenge
          </motion.p>
        </motion.div>

        <motion.div variants={rise} custom={5} initial="hidden" animate="show" className="mx-auto mt-12 max-w-[920px]">
          <VitalsMonitor />
          <p className="mt-3 text-center font-mono text-[11px] text-fg-muted">
            Simulated demonstration of a real failure: a metric that expects <span className="text-fg-secondary">purchase</span>{" "}
            receiving <span className="text-fg-secondary">Purchase</span>.
          </p>
        </motion.div>
      </div>
    </section>
  );
}
