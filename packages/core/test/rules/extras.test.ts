import { describe, expect, it } from 'vitest';
import { buildContext } from '../../src/rules/context';
import { ed013 } from '../../src/rules/ed013-no-metrics';
import { ed014 } from '../../src/rules/ed014-sample-ratio';
import { ed015 } from '../../src/rules/ed015-rollout-empty';
import { ed016 } from '../../src/rules/ed016-no-events-received';
import { healthyEvidence } from '../fixtures';

describe('ED-013 no metrics', () => {
  it('passes with a metric and fails without', () => {
    expect(ed013.run(buildContext(healthyEvidence())).status).toBe('pass');
    const ev = healthyEvidence();
    ev.config!.experiment!.metricIds = [];
    expect(ed013.run(buildContext(ev)).findings![0]!.title).toBe('Experiment "Checkout button" has no metric');
  });
});

describe('ED-014 sample ratio mismatch', () => {
  it('passes a fair split and warns on a skewed one', () => {
    expect(ed014.run(buildContext(healthyEvidence())).status).toBe('pass');
    const ev = healthyEvidence();
    ev.config!.results!.srmPValue = 0.00001;
    const f = ed014.run(buildContext(ev)).findings![0]!;
    expect(f).toMatchObject({ id: 'ED-014', severity: 'warning' });
  });
});

describe('ED-015 empty rollout', () => {
  it('fails a 0% rollout of a running experiment', () => {
    expect(ed015.run(buildContext(healthyEvidence())).status).toBe('pass');
    const ev = healthyEvidence();
    ev.config!.experiment!.rollout = { enabled: true, rolloutPercentage: 0 };
    expect(ed015.run(buildContext(ev)).findings![0]!.title).toMatch(/0%/);
  });
});

describe('ED-016 no events received', () => {
  it('treats zero events as pending, never as broken', () => {
    expect(ed016.run(buildContext(healthyEvidence())).status).toBe('pass');
    const ev = healthyEvidence();
    ev.config!.warehouses![0]!.totalEventsReceived = 0;
    const out = ed016.run(buildContext(ev));
    expect(out.status).toBe('pending');
    expect(out.findings![0]).toMatchObject({ kind: 'pending', severity: 'info' });
  });

  it('gives a fresh experiment time', () => {
    const ev = healthyEvidence();
    ev.config!.warehouses![0]!.totalEventsReceived = 0;
    ev.config!.experiment!.startedAt = '2026-11-27T09:55:00Z';
    expect(ed016.run(buildContext(ev)).status).toBe('skip');
  });
});
