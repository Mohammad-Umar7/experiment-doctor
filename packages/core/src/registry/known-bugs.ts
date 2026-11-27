import type { Evidence, Finding, UpstreamMatch } from '../types';

/**
 * Curated Flagsmith issues whose symptoms look like wiring bugs from the
 * outside. A match only says the symptoms *may be consistent* with the issue:
 * the human confirms the affected operation and error before acting, and the
 * Doctor never proposes a code patch for it.
 */
export interface KnownBug {
  issue: number;
  title: string;
  url: string;
  state: 'open' | 'closed';
  /** When `state` was last checked against GitHub (YYYY-MM-DD). */
  checkedOn: string;
  /** Version the reporter saw it on, and what changed since. */
  seenIn: string;
  symptoms: string[];
  /** What we need to see before suggesting the issue. */
  requiredEvidence: string[];
  workaround: string | null;
  workaroundSource: 'issue' | 'docs' | null;
  match(evidence: Evidence, findings: Finding[]): { confidence: number; matched: string[] } | null;
}

const gh = (n: number) => `https://github.com/Flagsmith/flagsmith/issues/${n}`;
const CHECKED_ON = '2026-11-27';

export const KNOWN_BUGS: KnownBug[] = [
  {
    issue: 9120,
    title: 'After an experiment is completed, its rollout override keeps splitting identities',
    url: gh(9120),
    state: 'closed',
    checkedOn: CHECKED_ON,
    seenIn: 'self-hosted 2.291.0; since 2.295.2 Complete can choose the rollout, and the docs were updated',
    symptoms: ['You completed the experiment and changed the flag default, but users still get their old variation.'],
    requiredEvidence: ['experiment status is completed', 'no rollout decision was recorded when completing', 'flag edits after completion do not reach enrolled identities (confirm by hand)'],
    workaround:
      "On 2.295.2 or newer, choose the rollout when completing (POST .../complete/ with a rollout_decision). On older versions: pause, set the default to the winner, set the rollout to 0% with the winner's weights, then complete.",
    workaroundSource: 'issue',
    match(ev) {
      const exp = ev.config?.experiment;
      if (!exp || exp.status !== 'completed' || exp.rolloutDecision) return null;
      return { confidence: 0.3, matched: ['experiment is completed', 'no rollout_decision recorded'] };
    },
  },
  {
    issue: 9129,
    title: 'Completing an experiment does not compute final results',
    url: gh(9129),
    state: 'closed',
    checkedOn: CHECKED_ON,
    seenIn: 'self-hosted 2.295.2',
    symptoms: ['The experiment is completed but results still show is_final: false with the old as_of.'],
    requiredEvidence: ['experiment status is completed', 'results.is_final is false'],
    workaround: 'Once the 5-minute refresh limit has passed, POST results/refresh/ one more time; the results then read is_final: true.',
    workaroundSource: 'issue',
    match(ev) {
      const exp = ev.config?.experiment;
      const res = ev.config?.results;
      if (!exp || exp.status !== 'completed' || !res || res.isFinal !== false) return null;
      return { confidence: 0.6, matched: ['experiment is completed', 'results are not final'] };
    },
  },
  {
    issue: 9132,
    title: 'Self-hosted: Postgres JIT makes the environment lookup take ~3 s, so SDK events time out',
    url: gh(9132),
    state: 'open',
    checkedOn: CHECKED_ON,
    seenIn: 'self-hosted 2.295.2 with postgres:15.5-alpine',
    symptoms: ['A few conversions go missing on a correctly wired experiment.', 'SDK logs show "Read timed out (read timeout=3)" and retries.'],
    requiredEvidence: ['self-hosted Flagsmith on PostgreSQL', 'an SDK request slower than 2.5 s (canary latency)'],
    workaround: 'Turn Postgres JIT off: in docker-compose set the postgres service command to ["postgres", "-c", "jit=off"].',
    workaroundSource: 'issue',
    match(ev) {
      const env = ev.config?.environment;
      const pg = ev.config?.warehouses?.some((w) => w.flagsmithDatabase || w.type === 'postgres');
      const slow = (ev.probe?.maxLatencyMs ?? 0) >= 2500;
      if (!env?.selfHosted || !slow) return null;
      return { confidence: pg ? 0.6 : 0.35, matched: ['self-hosted Flagsmith', `canary request took ${ev.probe!.maxLatencyMs} ms`, ...(pg ? ['PostgreSQL warehouse'] : [])] };
    },
  },
  {
    issue: 9133,
    title: 'Results banner declares a winner at any probability, docs say 95% / 5%',
    url: gh(9133),
    state: 'open',
    checkedOn: CHECKED_ON,
    seenIn: 'Flagsmith Cloud v2.294.0',
    symptoms: ['The results page says "Winner Probability Confirmed" or "Control is the winner" while the chance to win is between 5% and 95%.'],
    requiredEvidence: ['computed results with a variation whose chance to beat control is between 5% and 95%'],
    workaround: 'Treat any chance to win between 5% and 95% as inconclusive, whatever the banner says: read the chance to win and the credible interval, and keep the experiment running.',
    workaroundSource: 'docs',
    match(ev) {
      const res = ev.config?.results;
      if (!res) return null;
      const hits: string[] = [];
      for (const m of res.metrics) {
        for (const v of m.variants) {
          if (v.variant === 'control' || v.chanceToWin === null || v.chanceToWin === undefined) continue;
          if (v.chanceToWin > 0.05 && v.chanceToWin < 0.95) hits.push(`${v.variant}: ${Math.round(v.chanceToWin * 100)}% chance to beat control`);
        }
      }
      return hits.length ? { confidence: 0.7, matched: hits } : null;
    },
  },
  {
    issue: 9136,
    title: 'MCP: update_experiment sends PUT, which the experiments endpoint always rejects',
    url: gh(9136),
    state: 'open',
    checkedOn: CHECKED_ON,
    seenIn: 'self-hosted v2.295.2 and main',
    symptoms: ['Renaming an experiment or editing its hypothesis through the MCP update_experiment tool (a PUT) fails with HTTP 400 on "feature".'],
    requiredEvidence: ['an experiment update through update_experiment or a PUT to .../experiments/<id>/', 'the 400 error {"feature": [...]} (confirm by hand)'],
    workaround: 'Use PATCH instead: flagsmith api api/v1/environments/<env-key>/experiments/<id>/ -X PATCH --input - with {"hypothesis": "..."}.',
    workaroundSource: 'issue',
    match(ev) {
      const ops = ev.code?.experimentUpdates ?? [];
      if (ops.length) {
        return { confidence: 0.55, matched: ops.slice(0, 3).map((o) => `${o.via === 'http-put' ? 'PUT to experiments' : 'update_experiment'} at ${o.loc.file}:${o.loc.line}`) };
      }
      if (ev.code?.usesFlagsmithMcp) return { confidence: 0.15, matched: ['an MCP config mentions Flagsmith (no update_experiment or PUT call seen)'] };
      return null;
    },
  },
];

export function upstreamNote(issue: number, state: 'open' | 'closed', checkedOn: string): string {
  return `Symptoms may be consistent with Flagsmith issue #${issue} (${state} as of ${checkedOn}). Confirm the affected operation and error before applying the workaround.${state === 'closed' ? ' The issue is closed upstream: upgrading Flagsmith may already resolve it.' : ''}`;
}

export function matchKnownBugs(evidence: Evidence, findings: Finding[] = [], bugs: KnownBug[] = KNOWN_BUGS): UpstreamMatch[] {
  const out: UpstreamMatch[] = [];
  for (const bug of bugs) {
    const m = bug.match(evidence, findings);
    if (!m) continue;
    out.push({
      issue: bug.issue,
      title: bug.title,
      url: bug.url,
      state: bug.state,
      checkedOn: bug.checkedOn,
      confidence: m.confidence,
      matched: m.matched,
      workaround: bug.workaround,
      workaroundSource: bug.workaroundSource,
      note: `${upstreamNote(bug.issue, bug.state, bug.checkedOn)}${bug.workaround ? '' : ' No workaround is documented.'}`,
    });
  }
  return out.sort((a, b) => b.confidence - a.confidence);
}
