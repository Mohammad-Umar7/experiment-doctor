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
  it('reports patch, pipeline and experiment separately', () => {
    const v = compareReports(broken(), diagnose(healthyEvidence()));
    expect(v).toMatchObject({
      v: 2,
      patch: { status: 'PATCH_VERIFIED', target: 'ED-004' },
      pipeline: { status: 'PIPELINE_UNVERIFIED' },
      experiment: { status: 'EXPERIMENT_HEALTHY', verdict: 'HEALTHY' },
      resolved: ['ED-004'],
      introduced: [],
    });
    expect(v.pipeline.message).toMatch(/No probe ran/);
  });

  it('a passing patch does not make the experiment healthy while data is pending', () => {
    const after = healthyEvidence();
    after.config!.results!.metrics[0]!.variants = [
      { variant: 'control', identities: 10, conversions: 0 },
      { variant: 'green', identities: 12, conversions: 0 },
    ];
    const v = compareReports(broken(), diagnose(after));
    expect(v.patch.status).toBe('PATCH_VERIFIED');
    expect(v.experiment.status).toBe('EXPERIMENT_PENDING');
  });

  it('PATCH_FAILED when the finding is still there', () => {
    expect(compareReports(broken(), broken()).patch.status).toBe('PATCH_FAILED');
  });

  it('PATCH_UNVERIFIED when the check could not run any more', () => {
    const ev = healthyEvidence();
    ev.config = null;
    const v = compareReports(broken(), diagnose(ev));
    expect(v.patch.status).toBe('PATCH_UNVERIFIED');
    expect(v.experiment.status).toBe('EXPERIMENT_UNVERIFIABLE');
  });

  it('PATCH_FAILED when the fix introduced another problem', () => {
    const ev = healthyEvidence();
    ev.config!.warehouses = [];
    expect(compareReports(broken(), diagnose(ev))).toMatchObject({ patch: { status: 'PATCH_FAILED' }, introduced: ['ED-007'] });
  });

  it('never calls the pipeline verified from an ingestion-only canary', () => {
    const before = broken();
    const probe = { status: 'ACCEPTED' as const, at: '2026-11-27T11:00:00Z', identity: 'doctor-canary-1', identityLevel: false };
    const v = compareReports(before, diagnose(healthyEvidence()), probe);
    expect(v.pipeline.status).toBe('PIPELINE_UNVERIFIED');
    expect(v.pipeline.message).toMatch(/no identity-level read/);
    const proven = compareReports(before, diagnose(healthyEvidence()), { ...probe, status: 'IDENTITY_VERIFIED', identityLevel: true });
    expect(proven.pipeline.status).toBe('PIPELINE_VERIFIED');
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
