import { describe, expect, it } from 'vitest';
import { buildContext } from '../../src/rules/context';
import { ed001 } from '../../src/rules/ed001-variant-key';
import { healthyEvidence } from '../fixtures';

describe('ED-001 variation without key', () => {
  it('passes when every variation has a key', () => {
    expect(ed001.run(buildContext(healthyEvidence())).status).toBe('pass');
  });

  it('flags unlabelled variations and proposes keys', () => {
    const ev = healthyEvidence();
    ev.config!.flag!.variants = [
      { id: 11, value: 'Big Green', key: null },
      { id: 12, value: 'blue', key: 'blue' },
    ];
    ev.config!.experiment!.status = 'created';
    const out = ed001.run(buildContext(ev));
    expect(out.status).toBe('fail');
    const f = out.findings![0]!;
    expect(f).toMatchObject({ id: 'ED-001', severity: 'critical', layer: 'config', node: 'flagsmith' });
    expect(f.fix.command?.command).toBe('flagsmith feature variant update checkout_button 11 --key big_green');
    expect(f.fix.command?.writes).toBe(true);
  });

  it('warns that the flag is locked while running', () => {
    const ev = healthyEvidence();
    ev.config!.flag!.variants[0]!.key = '';
    const f = ed001.run(buildContext(ev)).findings![0]!;
    expect(f.fix.steps![0]).toMatch(/locked/);
  });

  it('skips without config evidence', () => {
    const ev = healthyEvidence();
    ev.config = null;
    expect(ed001.run(buildContext(ev)).status).toBe('skip');
  });
});
