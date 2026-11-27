import { describe, expect, it } from 'vitest';
import { buildContext } from '../../src/rules/context';
import { ed012 } from '../../src/rules/ed012-results-collecting';
import { healthyEvidence } from '../fixtures';

describe('ED-012 results still collecting', () => {
  it('passes when every variation has enough data', () => {
    expect(ed012.run(buildContext(healthyEvidence())).status).toBe('pass');
  });

  it('is pending, not broken, below the thresholds', () => {
    const ev = healthyEvidence();
    ev.config!.results!.metrics[0]!.variants = [
      { variant: 'control', identities: 23, conversions: 2 },
      { variant: 'green', identities: 19, conversions: 4 },
    ];
    const out = ed012.run(buildContext(ev));
    expect(out.status).toBe('pending');
    const f = out.findings![0]!;
    expect(f).toMatchObject({ id: 'ED-012', kind: 'pending', severity: 'info', layer: 'results' });
    expect(f.evidence.map((e) => e.label)).toEqual(['Purchases, control: 23/50 identities, 2/5 conversions', 'Purchases, green: 19/50 identities, 4/5 conversions']);
    expect(f.fix.command!.command).toContain('/results/refresh/ -X POST');
  });

  it('counts a variation missing from results as zero', () => {
    const ev = healthyEvidence();
    ev.config!.results!.metrics[0]!.variants = [{ variant: 'control', identities: 80, conversions: 9 }];
    const f = ed012.run(buildContext(ev)).findings![0]!;
    expect(f.evidence[0]!.label).toBe('Purchases, green: 0/50 identities, 0/5 conversions');
  });

  it('is pending when results were never computed', () => {
    const ev = healthyEvidence();
    ev.config!.results = null;
    expect(ed012.run(buildContext(ev)).findings![0]!.title).toMatch(/not been computed/);
  });

  it('skips for a draft experiment', () => {
    const ev = healthyEvidence();
    ev.config!.experiment!.status = 'created';
    expect(ed012.run(buildContext(ev)).status).toBe('skip');
  });
});
