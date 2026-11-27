import { describe, expect, it } from 'vitest';
import { buildContext } from '../../src/rules/context';
import { ed003 } from '../../src/rules/ed003-identity-mismatch';
import { appWith, healthyEvidence } from '../fixtures';

const run3 = (src: string) => ed003.run(buildContext(appWith(src)));

describe('ED-003 exposure and conversion identity mismatch', () => {
  it('passes for the healthy app', () => {
    expect(ed003.run(buildContext(healthyEvidence())).status).toBe('pass');
  });

  it('catches identify(user.id) then identify(user.email)', () => {
    const out = run3(`import flagsmith from '@flagsmith/flagsmith';
export async function show(user) {
  await flagsmith.identify(user.id);
  return flagsmith.getExperimentFlag('checkout_button');
}
export async function checkout(user) {
  await flagsmith.identify(user.email);
  flagsmith.trackEvent('purchase');
}`);
    expect(out.status).toBe('fail');
    const f = out.findings![0]!;
    expect(f.title).toMatch(/as an id .* and as an email/);
    expect(f.fix.patch).toMatchObject({ line: 7 });
    expect(f.fix.patch!.after).toContain('identify(user.id)');
  });

  it('catches Node identifiers that differ', () => {
    const ev = appWith(`import Flagsmith from '@flagsmith/nodejs';
const client = new Flagsmith({ environmentKey: KEY, enableEvents: true });
export async function run(user) {
  const flag = await client.getExperimentFlag('checkout_button', user.id);
  client.trackEvent('purchase', { identifier: user.email });
}`);
    const f = ed003.run(buildContext(ev)).findings![0]!;
    expect(f.title).toMatch(/conversions use an email/);
    expect(f.fix.patch!.after).toContain('identifier: user.id');
  });

  it('catches Node conversions with no identifier', () => {
    const ev = appWith(`import Flagsmith from '@flagsmith/nodejs';
const client = new Flagsmith({ environmentKey: KEY, enableEvents: true });
export async function run(user) {
  await client.getExperimentFlag('checkout_button', user.id);
  client.trackEvent('purchase');
}`);
    const f = ed003.run(buildContext(ev)).findings![0]!;
    expect(f.title).toMatch(/without an identifier/);
    expect(f.fix.patch!.after).toContain("trackEvent('purchase', { identifier: user.id })");
  });
});
