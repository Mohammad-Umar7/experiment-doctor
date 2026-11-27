import { describe, expect, it } from 'vitest';
import { diagnose } from '../src/diagnose';
import { appWith, healthyEvidence } from './fixtures';

describe('diagnose', () => {
  it('calls a fully evidenced healthy setup HEALTHY with a green pipeline', () => {
    const report = diagnose(healthyEvidence());
    expect(report.verdict).toBe('HEALTHY');
    expect(report.primaryFinding).toBeNull();
    expect(report.pipeline.map((n) => `${n.label}:${n.status}`)).toEqual(['App:ok', 'SDK:ok', 'Flagsmith:ok', 'Warehouse:ok', 'Results:ok']);
    expect(Object.values(report.layers).every((s) => s === 'ok')).toBe(true);
    expect(report.checks).toHaveLength(16);
    expect(report.target).toEqual({ flag: 'checkout_button', experimentId: 42, experimentName: 'Checkout button', environment: 'Staging' });
  });

  it('never paints green without evidence: code only is UNVERIFIABLE', () => {
    const ev = healthyEvidence();
    ev.config = null;
    const report = diagnose(ev);
    expect(report.verdict).toBe('UNVERIFIABLE');
    expect(report.pipeline.find((n) => n.id === 'flagsmith')!.status).toBe('unknown');
    expect(report.pipeline.find((n) => n.id === 'warehouse')!.status).toBe('unknown');
    expect(report.coverage).toEqual({ config: false, code: true, probe: false });
  });

  it('puts config blockers before code findings', () => {
    const ev = appWith(`import flagsmith from '@flagsmith/flagsmith';
export async function start(user) {
  await flagsmith.init({ environmentID: ENV, enableEvents: true });
  await flagsmith.identify(user.id);
  flagsmith.getExperimentFlag('checkout_button');
  flagsmith.trackEvent('Purchase');
}`);
    ev.config!.warehouses = [];
    const report = diagnose(ev);
    expect(report.verdict).toBe('REPAIR_REQUIRED');
    expect(report.findings.map((f) => f.id).slice(0, 2)).toEqual(['ED-007', 'ED-004']);
    expect(report.primaryFinding!.id).toBe('ED-007');
    expect(report.summary).toMatch(/^Repair required: "Staging" has no warehouse.*1 more issue after that\.$/);
    expect(report.pipeline.find((n) => n.id === 'app')!.status).toBe('broken');
    expect(report.pipeline.find((n) => n.id === 'warehouse')!.status).toBe('broken');
  });

  it('is PENDING, not broken, while results collect data', () => {
    const ev = healthyEvidence();
    ev.config!.results!.metrics[0]!.variants = [
      { variant: 'control', identities: 12, conversions: 1 },
      { variant: 'green', identities: 9, conversions: 0 },
    ];
    ev.config!.results!.srmPValue = null;
    const report = diagnose(ev);
    expect(report.verdict).toBe('PENDING');
    expect(report.primaryFinding!.id).toBe('ED-012');
    expect(report.pipeline.find((n) => n.id === 'results')!.status).toBe('unknown');
    expect(report.pipeline.find((n) => n.id === 'app')!.status).toBe('ok');
  });

  it('keeps advisory findings out of the verdict', () => {
    const ev = appWith(`import flagsmith from '@flagsmith/flagsmith';
export async function start(user) {
  await flagsmith.init({ environmentID: ENV, enableEvents: true });
  await flagsmith.identify(user.id);
  flagsmith.getExperimentFlag('checkout_button');
  flagsmith.trackEvent('purchase');
  document.title = 'shop';
}`);
    const report = diagnose(ev);
    expect(report.verdict).toBe('HEALTHY');
    expect(report.findings.map((f) => f.severity)).toEqual(['info']);
  });

  it('reports upstream bugs separately from findings', () => {
    const ev = healthyEvidence();
    ev.config!.results!.metrics[0]!.variants[1]!.chanceToWin = 0.84;
    const report = diagnose(ev);
    expect(report.verdict).toBe('HEALTHY');
    expect(report.upstream.map((u) => u.issue)).toEqual([9133]);
  });

  it('survives a rule that throws', () => {
    const report = diagnose(healthyEvidence(), {
      rules: [{ id: 'ED-001', title: 'boom', layer: 'config', node: 'flagsmith', rank: 1, run: () => { throw new Error('bad'); } }],
    });
    expect(report.checks[0]).toMatchObject({ status: 'skip', note: 'Check could not run: bad' });
  });
});
