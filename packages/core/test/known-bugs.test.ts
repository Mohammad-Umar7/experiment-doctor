import { describe, expect, it } from 'vitest';
import { KNOWN_BUGS, matchKnownBugs } from '../src/registry/known-bugs';
import { healthyEvidence } from './fixtures';

describe('known-bug registry', () => {
  it('covers the five curated issues with links and workaround status', () => {
    expect(KNOWN_BUGS.map((b) => b.issue)).toEqual([9120, 9129, 9132, 9133, 9136]);
    for (const b of KNOWN_BUGS) {
      expect(b.url).toBe(`https://github.com/Flagsmith/flagsmith/issues/${b.issue}`);
      expect(b.symptoms.length).toBeGreaterThan(0);
      expect(b.requiredEvidence.length).toBeGreaterThan(0);
    }
  });

  it('matches nothing on a conclusive healthy experiment', () => {
    expect(matchKnownBugs(healthyEvidence())).toEqual([]);
  });

  it('matches #9133 for an inconclusive result', () => {
    const ev = healthyEvidence();
    ev.config!.results!.metrics[0]!.variants[1]!.chanceToWin = 0.64;
    const [m] = matchKnownBugs(ev);
    expect(m).toMatchObject({ issue: 9133, state: 'open', matched: ['green: 64% chance to beat control'] });
    expect(m!.note).toMatch(/Possible upstream bug/);
  });

  it('matches #9129 when a completed experiment has non-final results', () => {
    const ev = healthyEvidence();
    ev.config!.experiment!.status = 'completed';
    ev.config!.experiment!.rolloutDecision = 'variant';
    ev.config!.results!.isFinal = false;
    expect(matchKnownBugs(ev).map((m) => m.issue)).toEqual([9129]);
  });

  it('matches #9132 only with a slow canary on self-hosted', () => {
    const ev = healthyEvidence();
    ev.config!.environment!.selfHosted = true;
    expect(matchKnownBugs(ev)).toEqual([]);
    ev.probe = { identity: 'doctor-canary-x', sentAt: '2026-11-27T10:00:00Z', maxLatencyMs: 3100 };
    expect(matchKnownBugs(ev)[0]!.issue).toBe(9132);
  });

  it('matches #9136 when the repo uses the Flagsmith MCP server', () => {
    const ev = healthyEvidence();
    ev.code!.usesFlagsmithMcp = true;
    expect(matchKnownBugs(ev)[0]!.issue).toBe(9136);
  });
});
