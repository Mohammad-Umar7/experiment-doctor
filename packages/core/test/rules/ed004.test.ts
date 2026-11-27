import { describe, expect, it } from 'vitest';
import { buildContext } from '../../src/rules/context';
import { ed004 } from '../../src/rules/ed004-metric-event-name';
import { appWith, healthyEvidence } from '../fixtures';

const app = (event: string) => `import flagsmith from '@flagsmith/flagsmith';
export async function start(user) {
  await flagsmith.identify(user.id);
  return flagsmith.getExperimentFlag('checkout_button');
}
export function buy() {
  flagsmith.trackEvent(${event});
}`;

describe('ED-004 metric event name mismatch', () => {
  it('passes on an exact match', () => {
    expect(ed004.run(buildContext(healthyEvidence())).status).toBe('pass');
  });

  it('catches a case-only mismatch and patches the literal', () => {
    const out = ed004.run(buildContext(appWith(app("'Purchase'"))));
    expect(out.status).toBe('fail');
    const f = out.findings![0]!;
    expect(f).toMatchObject({ id: 'ED-004', severity: 'critical', confidence: 0.97 });
    expect(f.title).toBe('The app sends "Purchase" but the metric counts "purchase"');
    expect(f.detail).toMatch(/differs only in letter case/);
    expect(f.fix.patch).toEqual({ file: 'src/flags.ts', line: 7, before: "  flagsmith.trackEvent('Purchase');", after: "  flagsmith.trackEvent('purchase');" });
  });

  it('catches format differences and typos', () => {
    const ev = appWith(app('"purchase-completed"'));
    ev.config!.metrics![0]!.event = 'purchase_completed';
    expect(ed004.run(buildContext(ev)).findings![0]!.detail).toMatch(/different word format/);
    const ev2 = appWith(app("'purchse'"));
    expect(ed004.run(buildContext(ev2)).findings![0]!.detail).toMatch(/misspelled/);
  });

  it('resolves constants but does not patch them in place', () => {
    const ev = appWith(`${app('EVENTS.BUY')}\nconst EVENTS = { BUY: 'Purchase' };`);
    const f = ed004.run(buildContext(ev)).findings![0]!;
    expect(f.fix.patch).toBeUndefined();
    expect(f.fix.steps![0]).toMatch(/EVENTS.BUY resolves to "Purchase"/);
  });

  it('reports a metric event that is never sent', () => {
    const f = ed004.run(buildContext(appWith(app("'signup'")))).findings![0]!;
    expect(f.title).toBe('No code sends the metric event "purchase"');
  });

  it('skips when names are computed at runtime', () => {
    expect(ed004.run(buildContext(appWith(app('name')))).status).toBe('skip');
  });

  it('skips without metrics', () => {
    const ev = healthyEvidence();
    delete ev.config!.metrics;
    expect(ed004.run(buildContext(ev)).status).toBe('skip');
  });
});
