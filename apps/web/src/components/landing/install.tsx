import { CopyCommand } from "@/components/copy-command";
import { Reveal } from "@/components/reveal";
import { Eyebrow } from "@/components/ui/panel";
import { REPO_URL } from "@/lib/site";

const WAYS = [
  {
    title: "CLI",
    body: "Run it in the repo that has the broken experiment. Read-only until you approve a fix.",
    command: "npx -y --package=https://experimentdoctor.vercel.app/doctor.tgz experiment-doctor check",
  },
  {
    title: "Agent Skill",
    body: "Give Claude Code or any coding agent the whole diagnose, approve, fix, verify workflow.",
    command: "cp -r skills/flagsmith-experiment-doctor ~/.claude/skills/",
  },
  {
    title: "CI Gate",
    body: "Fail the check on pull requests that would silently stop an experiment from counting.",
    command: "uses: Mohammad-Umar7/experiment-doctor@v0.1.0",
  },
];

export function Install() {
  return (
    <section id="install" className="scroll-mt-20 border-t border-border">
      <div className="mx-auto max-w-[1280px] px-4 py-20 sm:px-6 sm:py-24">
        <Reveal className="max-w-[640px]">
          <Eyebrow>Run it on your experiment</Eyebrow>
          <h2 className="mt-3 text-[28px] font-semibold tracking-[-0.03em] sm:text-[32px]">Three ways in. Same diagnosis.</h2>
          <p className="mt-3 text-[15px] leading-[1.6] text-fg-secondary">
            Uses your own <code className="font-mono text-[13px] text-fg">flagsmith login</code>. No keys are uploaded, nothing
            is sent anywhere unless you run the canary probe and say yes.
          </p>
        </Reveal>

        <div className="mt-10 grid gap-4 lg:grid-cols-3">
          {WAYS.map((way, i) => (
            <Reveal key={way.title} delay={i * 0.06} className="flex flex-col rounded-[var(--radius-card)] border border-border bg-surface p-5">
              <h3 className="text-base font-semibold">{way.title}</h3>
              <p className="mt-1.5 flex-1 text-[14px] leading-[1.6] text-fg-secondary">{way.body}</p>
              <CopyCommand command={way.command} className="mt-5" />
            </Reveal>
          ))}
        </div>

        <p className="mt-6 text-[13px] text-fg-muted">
          Source, setup and the benchmark are on{" "}
          <a href={REPO_URL} className="text-fg-secondary underline-offset-4 hover:text-fg hover:underline" target="_blank" rel="noreferrer">
            GitHub
          </a>
          .
        </p>
      </div>
    </section>
  );
}
