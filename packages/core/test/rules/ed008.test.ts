import { describe, expect, it } from 'vitest';
import { buildContext } from '../../src/rules/context';
import { ed008 } from '../../src/rules/ed008-experiment-not-running';
import { healthyEvidence } from '../fixtures';

const withStatus = (status: string) => {
  const ev = healthyEvidence();
  ev.config!.experiment!.status = status;
  return ed008.run(buildContext(ev));
};

describe('ED-008 experiment not running', () => {
  it('passes when running', () => {
    expect(withStatus('running').status).toBe('pass');
  });

  it('offers the start command for a draft, marked as a write', () => {
    const f = withStatus('created').findings![0]!;
    expect(f).toMatchObject({ id: 'ED-008', severity: 'critical', layer: 'config' });
    expect(f.fix.command).toMatchObject({ command: 'flagsmith api api/v1/environments/<env-key>/experiments/42/start/ -X POST', writes: true });
  });

  it('offers resume for a paused experiment', () => {
    expect(withStatus('paused').findings![0]!.fix.command!.description).toMatch(/Resume/);
  });

  it('explains a completed experiment', () => {
    expect(withStatus('completed').findings![0]!.title).toMatch(/completed/);
  });

  it('reports a missing experiment', () => {
    const ev = healthyEvidence();
    ev.config!.experiment = null;
    expect(ed008.run(buildContext(ev)).findings![0]!.title).toBe('There is no experiment for "checkout_button" in this environment');
  });
});
