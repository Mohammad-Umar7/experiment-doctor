import { Reveal } from "@/components/reveal";
import { ButtonLink } from "@/components/ui/button";
import { Eyebrow, Panel } from "@/components/ui/panel";
import { StatusPill } from "@/components/ui/status-pill";
import { doctorRecordFor } from "@/lib/doctor-record";

const DOCTOR_001 = doctorRecordFor("001");

export function ChallengeTeaser() {
  return (
    <section className="border-t border-border">
      <div className="mx-auto grid max-w-[1280px] items-center gap-12 px-4 py-20 sm:px-6 sm:py-24 lg:grid-cols-2">
        <Reveal>
          <Eyebrow>Human vs Doctor</Eyebrow>
          <h2 className="mt-3 text-[28px] font-semibold tracking-[-0.03em] sm:text-[32px]">Beat the machine.</h2>
          <p className="mt-3 max-w-[520px] text-[15px] leading-[1.6] text-fg-secondary">
            A real broken experiment, a code editor and three minutes. The Doctor repaired it in{" "}
            <span className="font-mono text-fg">{DOCTOR_001.time}</span>. Your repair is verified by the server, not by a
            button click, and the fastest humans go on the board.
          </p>
          <div className="mt-6 rounded-[var(--radius-card)] border border-accent/30 bg-accent/[0.06] p-4 text-[13px] leading-[1.6] text-fg-secondary">
            <p className="font-medium text-fg">This game is a Flagsmith experiment.</p>
            <p className="mt-1">
              Half the players get a full diagnostic report as their hint, the other half get one prioritized fix. The flag{" "}
              <code className="font-mono text-[12px] text-fg">doctor_hint_style</code> decides, and Flagsmith measures which
              one gets more people to a verified repair within 180 seconds.
            </p>
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href="/play" size="lg">
              Start the challenge
            </ButtonLink>
            <ButtonLink href="/leaderboard" size="lg" variant="secondary">
              See the leaderboard
            </ButtonLink>
          </div>
        </Reveal>

        <Reveal delay={0.08}>
          <Panel className="overflow-hidden shadow-[var(--shadow-card)]">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg-muted">Case 001 / missing conversions</p>
              <StatusPill status="critical" pulse>
                Unhealthy
              </StatusPill>
            </div>
            <div className="grid grid-cols-2 divide-x divide-border border-b border-border">
              <div className="px-5 py-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg-muted">Your time</p>
                <p className="mt-1 font-mono text-[32px] font-medium tabular text-fg">03:00</p>
              </div>
              <div className="px-5 py-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg-muted">Doctor&apos;s record</p>
                <p className="mt-1 font-mono text-[32px] font-medium tabular text-healthy">{DOCTOR_001.time}</p>
                <p className="font-mono text-[11px] text-fg-muted">{DOCTOR_001.turns} agent turns · {DOCTOR_001.model}</p>
              </div>
            </div>
            <pre className="overflow-x-auto px-5 py-4 font-mono text-[12.5px] leading-[1.8] text-fg-secondary">
              <code>
                <span className="text-fg-muted">1 </span>await flagsmith.identify(user.id);{"\n"}
                <span className="text-fg-muted">2 </span>const flag = flagsmith.getExperimentFlag(&quot;checkout_button&quot;);{"\n"}
                <span className="text-fg-muted">3 </span>renderCheckout(flag.value);{"\n"}
                <span className="text-fg-muted">4 </span>
                <span className="rounded bg-critical/10 text-critical">flagsmith.trackEvent(&quot;Purchase&quot;);</span>
              </code>
            </pre>
          </Panel>
        </Reveal>
      </div>
    </section>
  );
}
