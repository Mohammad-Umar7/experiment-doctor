import { Reveal } from "@/components/reveal";
import { Eyebrow } from "@/components/ui/panel";
import { FAILURES, LAYER_LABEL } from "@/lib/failures";

export function FailureCatalog() {
  return (
    <section className="border-t border-border">
      <div className="mx-auto max-w-[1280px] px-4 py-20 sm:px-6 sm:py-24">
        <Reveal className="max-w-[640px]">
          <Eyebrow>What it checks</Eyebrow>
          <h2 className="mt-3 text-[28px] font-semibold tracking-[-0.03em] sm:text-[32px]">
            Twelve ways an experiment dies quietly.
          </h2>
          <p className="mt-3 text-[15px] leading-[1.6] text-fg-secondary">
            Each one comes from the Flagsmith Experimentation docs and the beta&apos;s open issues. If your symptoms match a
            known upstream bug, the Doctor says so instead of inventing a fix.
          </p>
        </Reveal>

        <Reveal delay={0.06}>
          <ul className="mt-10 grid grid-cols-1 gap-px overflow-hidden rounded-[var(--radius-card)] border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
            {FAILURES.map((f) => (
              <li key={f.id} className="min-w-0 bg-surface px-5 py-4">
                <div className="flex items-baseline justify-between gap-3">
                  <span className={`font-mono text-[12px] ${f.id === "ED-012" ? "text-warning" : "text-critical"}`}>{f.id}</span>
                  <span className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-fg-muted">{LAYER_LABEL[f.layer]}</span>
                </div>
                <p className="mt-1.5 text-[14px] font-medium text-fg">{f.title}</p>
                <p className="mt-0.5 text-[12.5px] leading-[1.5] text-fg-muted">{f.fix}</p>
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </section>
  );
}
