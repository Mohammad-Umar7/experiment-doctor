import { describe, expect, it } from 'vitest';
import { buildContext } from '../../src/rules/context';
import { ed011 } from '../../src/rules/ed011-no-exposure-call';
import { appWith, healthyEvidence } from '../fixtures';

describe('ED-011 plain flag read instead of getExperimentFlag', () => {
  it('passes when getExperimentFlag reads the flag', () => {
    expect(ed011.run(buildContext(healthyEvidence())).status).toBe('pass');
  });

  it('rewrites getValue into getExperimentFlag(...)?.value', () => {
    const f = ed011.run(
      buildContext(
        appWith(`import flagsmith from '@flagsmith/flagsmith';
export async function start(user) {
  await flagsmith.identify(user.id);
  const colour = flagsmith.getValue('checkout_button');
  return colour;
}`),
      ),
    ).findings![0]!;
    expect(f).toMatchObject({ id: 'ED-011', severity: 'critical' });
    expect(f.fix.patch!.after).toBe("  const colour = flagsmith.getExperimentFlag('checkout_button')?.value;");
  });

  it('rewrites hasFeature into ?.enabled', () => {
    const f = ed011.run(buildContext(appWith(`import flagsmith from '@flagsmith/flagsmith';\nif (flagsmith.hasFeature('checkout_button')) show();`))).findings![0]!;
    expect(f.fix.patch!.after).toBe("if (flagsmith.getExperimentFlag('checkout_button')?.enabled) show();");
  });

  it('explains useFlags in React', () => {
    const f = ed011.run(
      buildContext(appWith(`import { useFlags } from 'flagsmith/react';\nexport const B = () => { const f = useFlags(['checkout_button']); return f.checkout_button.value; };`)),
    ).findings![0]!;
    expect(f.fix.summary).toMatch(/useExperiment\('checkout_button'\)/);
  });

  it('warns when the flag is never referenced', () => {
    const f = ed011.run(buildContext(appWith(`import flagsmith from '@flagsmith/flagsmith';\nflagsmith.trackEvent('purchase');`))).findings![0]!;
    expect(f.severity).toBe('warning');
    expect(f.title).toMatch(/never reads/);
  });
});
