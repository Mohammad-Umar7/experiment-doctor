import { CopyCommand } from "@/components/copy-command";
import { Reveal } from "@/components/reveal";
import { Eyebrow } from "@/components/ui/panel";
import { StatusPill } from "@/components/ui/status-pill";
import { REPO_URL } from "@/lib/site";

const WORKFLOW = `- uses: actions/checkout@v5
  with: { fetch-depth: 0 }
- uses: Mohammad-Umar7/experiment-doctor@v0.2.0`;

export function CiGate() {
  return (
    <section className="border-t border-border">
      <div className="mx-auto grid max-w-[1280px] grid-cols-1 items-center gap-12 px-4 py-20 sm:px-6 sm:py-24 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <Reveal className="min-w-0">
          <Eyebrow>CI Gate</Eyebrow>
          <h2 className="mt-3 text-[28px] font-semibold tracking-[-0.03em] sm:text-[32px]">
            Never ship a silently broken experiment again.
          </h2>
          <p className="mt-3 max-w-[520px] text-[15px] leading-[1.6] text-fg-secondary">
            Renaming <code className="font-mono text-[13px] text-fg">purchase</code> to{" "}
            <code className="font-mono text-[13px] text-fg">Purchase</code> passes every build, test and review, and the
            experiment quietly stops counting. The Doctor&apos;s GitHub Action fails the pull request that breaks it. No secrets
            needed.
          </p>
          <pre className="mt-6 overflow-x-auto rounded-[10px] border border-border bg-canvas px-4 py-3 font-mono text-[12.5px] leading-[1.7] text-fg-secondary">
            {WORKFLOW}
          </pre>
          <a
            href={`${REPO_URL}/pull/1`}
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-block text-[13px] text-fg-secondary underline-offset-4 hover:text-fg hover:underline"
          >
            See it fail a real pull request →
          </a>
        </Reveal>

        <Reveal delay={0.08} className="min-w-0">
          <div className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface shadow-[var(--shadow-card)]">
            <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
              <p className="truncate text-[13px] text-fg">
                <span className="text-fg-muted">#1</span> Demo: capitalize analytics event names
              </p>
              <StatusPill status="critical">Check failing</StatusPill>
            </div>
            <ul className="divide-y divide-border text-[13px]">
              <li className="flex items-center justify-between px-5 py-3">
                <span className="text-fg-secondary">
                  <span className="mr-2 text-healthy">✓</span>Build and unit tests
                </span>
                <span className="font-mono text-[11px] text-fg-muted">passed</span>
              </li>
              <li className="flex items-center justify-between px-5 py-3">
                <span className="text-fg">
                  <span className="mr-2 text-critical">✕</span>Experiment Doctor / Experiment integrity
                </span>
                <span className="font-mono text-[11px] text-critical">failed in 3s</span>
              </li>
            </ul>
            <div className="border-t border-border bg-canvas/60 px-5 py-4">
              <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-critical">
                demo/checkout-app/src/checkout.js:12
              </p>
              <p className="mt-1.5 text-[13.5px] text-fg">Experiment regression: conversion event renamed</p>
              <pre className="mt-3 overflow-x-auto rounded-md border border-border bg-canvas px-3 py-2 font-mono text-[12px] leading-[1.7]">
                <span className="block text-critical">− flagsmith.trackEvent(&quot;purchase&quot;);</span>
                <span className="block text-healthy">+ flagsmith.trackEvent(&quot;Purchase&quot;);</span>
              </pre>
              <p className="mt-3 text-[12.5px] leading-[1.6] text-fg-muted">
                The metric still listens for &quot;purchase&quot;. Conversions will silently stop counting. Also reported as ED-004
                at 97% confidence.
              </p>
            </div>
          </div>
          <CopyCommand command="node packages/action/dist/main.js --base origin/main" className="mt-4" />
        </Reveal>
      </div>
    </section>
  );
}
