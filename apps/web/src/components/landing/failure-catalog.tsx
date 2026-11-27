import { Reveal } from "@/components/reveal";
import { Eyebrow } from "@/components/ui/panel";
import { FAILURES, LAYER_LABEL } from "@/lib/failures";

export function FailureCatalog() {
  return (
    <section className="border-t border-border">
      <div className="mx-auto grid max-w-[1280px] gap-12 px-4 py-20 sm:px-6 sm:py-24 lg:grid-cols-[360px_1fr]">
        <Reveal>
          <Eyebrow>What it checks</Eyebrow>
          <h2 className="mt-3 text-[28px] font-semibold tracking-[-0.03em] sm:text-[32px]">
            Twelve ways an experiment dies quietly.
          </h2>
          <p className="mt-3 text-[15px] leading-[1.6] text-fg-secondary">
            Each one comes straight from the Flagsmith Experimentation docs and the beta&apos;s open issues. If your
            symptoms match a known upstream bug, the Doctor says so instead of inventing a fix.
          </p>
        </Reveal>

        <Reveal delay={0.06}>
          <ul className="divide-y divide-border overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
            {FAILURES.map((f) => (
              <li key={f.id} className="grid gap-1 px-5 py-4 sm:grid-cols-[84px_1fr_auto] sm:items-baseline sm:gap-4">
                <span className={`font-mono text-[12px] ${f.id === "ED-012" ? "text-warning" : "text-critical"}`}>{f.id}</span>
                <div>
                  <p className="text-[14px] font-medium text-fg">{f.title}</p>
                  <p className="mt-0.5 text-[13px] leading-[1.55] text-fg-muted">{f.fix}</p>
                </div>
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-fg-muted">{LAYER_LABEL[f.layer]}</span>
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </section>
  );
}
