import { describe, expect, it } from 'vitest';
import { buildContext } from '../../src/rules/context';
import { ed006 } from '../../src/rules/ed006-events-endpoint';
import { appWith, healthyEvidence } from '../fixtures';

const app = (options: string) => `import flagsmith from '@flagsmith/flagsmith';
export async function start(user) {
  await flagsmith.init({
    environmentID: ENV,
${options}
    enableEvents: true,
  });
  await flagsmith.identify(user.id);
  return flagsmith.getExperimentFlag('checkout_button');
}`;

describe('ED-006 wrong events endpoint', () => {
  it('passes for a Cloud app with default URLs', () => {
    expect(ed006.run(buildContext(healthyEvidence())).status).toBe('pass');
  });

  it('flags a self-hosted API with the default Cloud events URL and patches it', () => {
    const ev = appWith(app("    api: 'http://localhost:8000/api/v1/',"));
    ev.config!.warehouses = [{ id: 1, type: 'postgres', status: 'connected', flagsmithDatabase: true }];
    const f = ed006.run(buildContext(ev)).findings![0]!;
    expect(f).toMatchObject({ id: 'ED-006', severity: 'critical', layer: 'transport' });
    expect(f.title).toBe('Flags come from localhost but events go to Flagsmith Cloud');
    expect(f.fix.patch).toEqual({
      file: 'src/flags.ts',
      line: 5,
      before: "    api: 'http://localhost:8000/api/v1/',",
      after: "    api: 'http://localhost:8000/api/v1/',\n    eventProcessorConfig: { eventsApiUrl: 'http://localhost:8000/api/' },",
    });
  });

  it('flags an events URL that ends in /api/v1/', () => {
    const ev = appWith(app("    api: 'https://flags.acme.io/api/v1/',\n    eventProcessorConfig: { eventsApiUrl: 'https://flags.acme.io/api/v1/' },"));
    const f = ed006.run(buildContext(ev)).findings![0]!;
    expect(f.title).toMatch(/v1\/v1\/events/);
    expect(f.fix.patch!.after).toContain("eventsApiUrl: 'https://flags.acme.io/api/'");
  });

  it('flags Cloud flags with events sent elsewhere', () => {
    const ev = appWith(app("    eventProcessorConfig: { eventsApiUrl: 'http://localhost:8000/api/' },"));
    expect(ed006.run(buildContext(ev)).findings![0]!.title).toBe('Flags come from Flagsmith Cloud but events go to localhost');
  });

  it('flags an app on Cloud when the CLI points at a self-hosted Flagsmith', () => {
    const ev = healthyEvidence();
    ev.config!.environment = { name: 'Staging', selfHosted: true, apiUrl: 'http://localhost:8000' };
    const f = ed006.run(buildContext(ev)).findings![0]!;
    expect(f.title).toMatch(/lives on localhost/);
    expect(f.fix.patch!.after).toContain("api: 'http://localhost:8000/api/v1/',");
  });

  it('skips runtime-configured URLs on Cloud', () => {
    const ev = appWith(app('    api: process.env.FLAGSMITH_API,'));
    expect(ed006.run(buildContext(ev)).status).toBe('skip');
  });
});
