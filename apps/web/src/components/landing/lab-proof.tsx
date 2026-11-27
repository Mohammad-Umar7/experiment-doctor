import { Reveal } from "@/components/reveal";
import { Eyebrow } from "@/components/ui/panel";

const STEPS = [
  { cmd: "docker compose -p doctor-lab -f selfhost/docker-compose.yml up -d", note: "self-hosted Flagsmith, Experimentation on, events in its own Postgres" },
  { cmd: "node selfhost/seed.mjs", note: "flag, metric and a running experiment" },
  { cmd: "node selfhost/lab.mjs broken", note: "real SDK traffic from the shipped bug" },
];

/** Output captured from a real run against the lab (see selfhost/verify-events.mjs). */
const BEFORE = `events stored for lab-broken-mwzesjta-3:
  20:03:28.150Z  $flag_exposure (checkout_button) = control
  20:03:28.150Z  Purchase

FAILED   conversion stored as "Purchase", the metric counts "purchase"`;

const AFTER = `events stored for doctor-probe-mwzet3ec:
  20:03:53.170Z  $flag_exposure (checkout_button) = control
  20:03:53.170Z  purchase

PIPELINE_VERIFIED  exposure and "purchase" stored for the same identity, in order`;

export function LabProof() {
  return (
    <section className="border-t border-border">
      <div className="mx-auto max-w-[1280px] px-4 py-20 sm:px-6 sm:py-24">
        <Reveal className="max-w-[680px]">
          <Eyebrow>Self-hosted rescue lab</Eyebrow>
          <h2 className="mt-3 text-[28px] font-semibold tracking-[-0.03em] sm:text-[32px]">
            Proof per identity, not a green checkmark.
          </h2>
          <p className="mt-3 text-[15px] leading-[1.6] text-fg-secondary">
            On self-hosted Flagsmith the events land in your own Postgres. The lab reads them for one identity and only says
            verified when that identity&apos;s exposure and the metric&apos;s exact event were both stored, in order. Aggregate
            counters going up is never treated as proof.
          </p>
        </Reveal>

        <div className="mt-10 grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <Reveal className="rounded-[var(--radius-card)] border border-border bg-surface p-5">
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg-muted">Three commands</p>
            <ol className="mt-4 space-y-4">
              {STEPS.map((s, i) => (
                <li key={s.cmd}>
                  <code className="block break-all font-mono text-[12px] text-fg">
                    <span className="select-none text-fg-muted">{i + 1} $ </span>
                    {s.cmd}
                  </code>
                  <p className="mt-1 text-[12.5px] text-fg-muted">{s.note}</p>
                </li>
              ))}
            </ol>
          </Reveal>
          <Reveal delay={0.06} className="overflow-hidden rounded-[var(--radius-card)] border border-critical/30 bg-surface">
            <p className="border-b border-border px-5 py-3 font-mono text-[11px] uppercase tracking-[0.14em] text-critical">
              Before the fix
            </p>
            <pre className="overflow-x-auto px-5 py-4 font-mono text-[12px] leading-[1.7] text-fg-secondary">{BEFORE}</pre>
          </Reveal>
          <Reveal delay={0.12} className="overflow-hidden rounded-[var(--radius-card)] border border-healthy/30 bg-surface">
            <p className="border-b border-border px-5 py-3 font-mono text-[11px] uppercase tracking-[0.14em] text-healthy">
              After the approved patch
            </p>
            <pre className="overflow-x-auto px-5 py-4 font-mono text-[12px] leading-[1.7] text-fg-secondary">{AFTER}</pre>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
