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
    const failed = compareReports(before, diagnose(healthyEvidence()), { ...probe, status: 'FAILED', identityLevel: true, detail: 'no "purchase" event stored' });
    expect(failed.pipeline).toMatchObject({ status: 'PIPELINE_FAILED', message: 'The probe for doctor-canary-1 failed: no "purchase" event stored' });
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

describe('pipeline evidence binding', () => {
  const ctx = { envFingerprint: 'fnv1a:00000001', experimentId: 42, flag: 'checkout_button', events: ['purchase'], since: '2026-11-28T10:00:00.000Z', sinceReason: 'repair' as const };
  const binding = { envFingerprint: 'fnv1a:00000001', experimentId: 42, flag: 'checkout_button', event: 'purchase' };
  const verified = { status: 'IDENTITY_VERIFIED' as const, at: '2026-11-28T10:01:00.000Z', evidenceAt: '2026-11-28T10:00:30.000Z', identity: 'u1', identityLevel: true, scope: 'app-sdk' as const, binding };
  const run = (probe: Parameters<typeof compareReports>[2]) => compareReports(broken(), diagnose(healthyEvidence()), probe, ctx).pipeline;

  it('verifies bound evidence newer than the repair', () => {
    expect(run(verified).status).toBe('PIPELINE_VERIFIED');
  });

  it('rejects evidence older than the repair, even for the same identity', () => {
    const p = run({ ...verified, evidenceAt: '2026-11-28T09:59:59.000Z' });
    expect(p.status).toBe('PIPELINE_UNVERIFIED');
    expect(p.message).toMatch(/older than the repair/);
  });

  it('rejects evidence for another environment, experiment, flag or event', () => {
    expect(run({ ...verified, binding: { ...binding, envFingerprint: 'fnv1a:ffffffff' } }).message).toMatch(/different environment/);
    expect(run({ ...verified, binding: { ...binding, experimentId: 7 } }).message).toMatch(/experiment 7, not 42/);
    expect(run({ ...verified, binding: { ...binding, flag: 'other' } }).message).toMatch(/flag "other"/);
    expect(run({ ...verified, binding: { ...binding, event: 'signup' } }).message).toMatch(/event "signup"/);
    const { binding: _b, ...unbound } = verified;
    expect(run(unbound).status).toBe('PIPELINE_UNVERIFIED');
  });

  it('refuses to bind when the current environment is unknown', () => {
    const p = compareReports(broken(), diagnose(healthyEvidence()), verified, { ...ctx, envFingerprint: undefined }).pipeline;
    expect(p.message).toMatch(/environment key is unknown/);
  });

  it('reports unreadable evidence as unverified with its reason', () => {
    const p = run({ status: 'UNAVAILABLE', at: '2026-11-28T10:01:00.000Z', identity: 'u1', identityLevel: false, detail: 'docker is not installed' });
    expect(p).toMatchObject({ status: 'PIPELINE_UNVERIFIED', message: 'Not verified: docker is not installed.' });
  });
});
