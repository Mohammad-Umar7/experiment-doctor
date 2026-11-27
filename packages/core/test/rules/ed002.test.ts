import { describe, expect, it } from 'vitest';
import { buildContext } from '../../src/rules/context';
import { ed002 } from '../../src/rules/ed002-no-identify';
import { appWith, healthyEvidence } from '../fixtures';

const run2 = (src: string) => ed002.run(buildContext(appWith(src)));

describe('ED-002 no identify before getExperimentFlag', () => {
  it('passes for the healthy app', () => {
    expect(ed002.run(buildContext(healthyEvidence())).status).toBe('pass');
  });

  it('flags an app that never identifies, with a placeholder patch', () => {
    const out = run2(`import flagsmith from '@flagsmith/flagsmith';
export async function show() {
  await flagsmith.init({ environmentID: ENV, enableEvents: true });
  const flag = flagsmith.getExperimentFlag('checkout_button');
  return flag;
}`);
    expect(out.status).toBe('fail');
    const f = out.findings![0]!;
    expect(f).toMatchObject({ id: 'ED-002', severity: 'critical', layer: 'identity' });
    expect(f.fix.patch).toMatchObject({ line: 4, placeholder: true });
    expect(f.fix.patch!.after).toContain('await flagsmith.identify(user.id);\n  const flag');
  });

  it('flags identify() that runs after the flag read', () => {
    const out = run2(`import flagsmith from '@flagsmith/flagsmith';
export async function show(user) {
  const flag = flagsmith.getExperimentFlag('checkout_button');
  await flagsmith.identify(user.id);
}`);
    expect(out.findings![0]!.title).toMatch(/after getExperimentFlag/);
  });

  it('warns when identify() is not awaited right before the read', () => {
    const out = run2(`import flagsmith from '@flagsmith/flagsmith';
export function show(user) {
  flagsmith.identify(user.id);
  return flagsmith.getExperimentFlag('checkout_button');
}`);
    const f = out.findings![0]!;
    expect(f.severity).toBe('warning');
    expect(f.fix.patch!.after.trim()).toBe('await flagsmith.identify(user.id);');
  });

  it('flags a Node read without identifier', () => {
    const ev = appWith(`import Flagsmith from '@flagsmith/nodejs';
const client = new Flagsmith({ environmentKey: KEY, enableEvents: true });
export async function handler() { return client.getExperimentFlag('checkout_button'); }`);
    // one argument looks like the JS signature; force the node SDK
    ev.code!.experimentFlags[0]!.sdk = 'node';
    const out = ed002.run(buildContext(ev));
    expect(out.findings![0]!.title).toMatch(/without an identifier/);
  });
});
