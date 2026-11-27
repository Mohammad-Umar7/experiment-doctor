import { describe, expect, it } from 'vitest';
import { KNOWN_BUGS, matchKnownBugs } from '../src/registry/known-bugs';
import { healthyEvidence } from './fixtures';

describe('known-bug registry', () => {
  it('covers the five curated issues with links and workaround status', () => {
    expect(KNOWN_BUGS.map((b) => b.issue)).toEqual([9120, 9129, 9132, 9133, 9136]);
    expect(Object.fromEntries(KNOWN_BUGS.map((b) => [b.issue, b.state]))).toEqual({ 9120: 'closed', 9129: 'closed', 9132: 'open', 9133: 'open', 9136: 'open' });
    for (const b of KNOWN_BUGS) {
      expect(b.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
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
    expect(m!.note).toMatch(/^Symptoms may be consistent with Flagsmith issue #9133 \(open as of \d{4}-\d{2}-\d{2}\)\. Confirm the affected operation and error before applying the workaround\./);
    expect(m!.note).not.toMatch(/not caused by your code/i);
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

  it('matches #9136 strongly only when the affected operation is in the code', () => {
    const ev = healthyEvidence();
    ev.code!.usesFlagsmithMcp = true;
    const weak = matchKnownBugs(ev)[0]!;
    expect(weak).toMatchObject({ issue: 9136, confidence: 0.15 });
    ev.code!.experimentUpdates = [{ loc: { file: 'scripts/rename.ts', line: 4 }, via: 'http-put' }];
    const strong = matchKnownBugs(ev)[0]!;
    expect(strong.confidence).toBeGreaterThan(0.5);
    expect(strong.matched).toEqual(['PUT to experiments at scripts/rename.ts:4']);
  });

  it('says when an issue is closed upstream', () => {
    const ev = healthyEvidence();
    ev.config!.experiment!.status = 'completed';
    ev.config!.experiment!.rolloutDecision = 'variant';
    ev.config!.results!.isFinal = false;
    expect(matchKnownBugs(ev)[0]!.note).toMatch(/closed upstream/);
  });
});
