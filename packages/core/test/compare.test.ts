import { describe, expect, it } from 'vitest';
import { compareReports } from '../src/compare';
import { diagnose } from '../src/diagnose';
import { toAgentSummary } from '../src/summary';
import { appWith, healthyEvidence } from './fixtures';

const broken = () =>
  diagnose(
    appWith(`import flagsmith from '@flagsmith/flagsmith';
export async function start(user) {
  await flagsmith.init({ environmentID: ENV, enableEvents: true });
  await flagsmith.identify(user.id);
  flagsmith.getExperimentFlag('checkout_button');
  flagsmith.trackEvent('Purchase');
}
window.addEventListener('pagehide', () => flagsmith.flushEvents());`),
  );

describe('compareReports', () => {
  it('VERIFIED when the target check now passes', () => {
    const c = compareReports(broken(), diagnose(healthyEvidence()));
    expect(c).toMatchObject({ status: 'VERIFIED', target: 'ED-004', resolved: ['ED-004'], introduced: [] });
    expect(c.message).toBe('ED-004 is fixed: its check now passes. The experiment is healthy.');
  });

  it('FAILED when the finding is still there', () => {
    expect(compareReports(broken(), broken()).status).toBe('FAILED');
  });

  it('PENDING when the check could not run any more', () => {
    const ev = healthyEvidence();
    ev.config = null;
    const c = compareReports(broken(), diagnose(ev));
    expect(c.status).toBe('PENDING');
    expect(c.message).toMatch(/not verified/);
  });

  it('FAILED when the fix introduced another problem', () => {
    const ev = healthyEvidence();
    ev.config!.warehouses = [];
    expect(compareReports(broken(), diagnose(ev))).toMatchObject({ status: 'FAILED', introduced: ['ED-007'] });
  });
});

describe('toAgentSummary', () => {
  it('keeps the primary finding in full and the rest as one-liners', () => {
    const s = toAgentSummary(broken());
    expect(s.verdict).toBe('REPAIR_REQUIRED');
    expect(s.primary!.id).toBe('ED-004');
    expect(s.primary!.fix.patch).toBeDefined();
    expect(s.pipeline).toEqual({ app: 'broken', sdk: 'ok', flagsmith: 'ok', warehouse: 'ok', results: 'ok' });
    expect(s.next).toBe('experiment-doctor fix');
    expect(s.checks.fail).toBe(1);
  });
});
