import { describe, expect, it } from 'vitest';
import { buildContext } from '../../src/rules/context';
import { ed009 } from '../../src/rules/ed009-enable-events';
import { appWith, healthyEvidence } from '../fixtures';

const app = (extra: string) => `import flagsmith from '@flagsmith/flagsmith';
export async function start(user) {
  await flagsmith.init({
    environmentID: ENV,${extra}
  });
  await flagsmith.identify(user.id);
  return flagsmith.getExperimentFlag('checkout_button');
}`;

describe('ED-009 enableEvents missing', () => {
  it('passes when enableEvents is true', () => {
    expect(ed009.run(buildContext(healthyEvidence())).status).toBe('pass');
  });

  it('flags a missing option and inserts it after the opening line', () => {
    const f = ed009.run(buildContext(appWith(app('\n    enableAnalytics: true,')))).findings![0]!;
    expect(f).toMatchObject({ id: 'ED-009', severity: 'critical', node: 'sdk' });
    expect(f.detail).toMatch(/enableAnalytics is a different setting/);
    expect(f.fix.patch).toEqual({
      file: 'src/flags.ts',
      line: 3,
      before: '  await flagsmith.init({',
      after: '  await flagsmith.init({\n    enableEvents: true,',
    });
  });

  it('flips enableEvents: false', () => {
    const f = ed009.run(buildContext(appWith(app('\n    enableEvents: false,')))).findings![0]!;
    expect(f.fix.patch!.after).toBe('    enableEvents: true,');
  });

  it('warns when the value is computed', () => {
    const f = ed009.run(buildContext(appWith(app("\n    enableEvents: import.meta.env.VITE_EVENTS === 'on',")))).findings![0]!;
    expect(f.severity).toBe('warning');
  });

  it('mentions the Node ValueError', () => {
    const ev = appWith(`import Flagsmith from '@flagsmith/nodejs';
const client = new Flagsmith({
  environmentKey: KEY,
});
export const run = (id) => client.getExperimentFlag('checkout_button', id);`);
    expect(ed009.run(buildContext(ev)).findings![0]!.detail).toMatch(/ValueError/);
  });
});
