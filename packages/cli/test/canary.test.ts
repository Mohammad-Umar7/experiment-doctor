import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from '../src/main';
import { APP_FILES, ENV_KEY, fakeIo, flagsmithState, tempDir } from './helpers';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const identityFlags = (inExperiment = true, variant: string | null = 'green') =>
  json({
    flags: [
      {
        feature: { id: 7, name: 'checkout_button' },
        enabled: true,
        feature_state_value: 'green',
        ...(variant ? { variant } : {}),
        metadata: { experiment: { id: 42, name: 'Checkout button', in_experiment: inExperiment } },
      },
    ],
  });

const accepted = (url: string) => (url.includes('/identities/') ? identityFlags() : json({ accepted: 2, rejected: [] }, 202));

function setup(opts: { fetch?: (url: string, init?: RequestInit) => Response; answers?: string[]; state?: Record<string, unknown> } = {}) {
  const dir = tempDir(APP_FILES);
  const state = flagsmithState({
    'environment get Staging --json': { name: 'Staging', api_key: ENV_KEY },
    'environment get prod --json': { name: 'prod', api_key: ENV_KEY },
    ...opts.state,
  });
  return { dir, io: fakeIo({ cwd: dir, flagsmith: state, answers: opts.answers ?? ['Staging'], fetch: opts.fetch }) };
}

const last = (s: string) => JSON.parse(s.trim().split('\n').pop()!);

describe('canary', () => {
  it('needs an environment the user names', async () => {
    const { io } = setup();
    expect(await main(['canary'], io)).toBe(2);
    expect(io.err()).toMatch(/--environment/);
  });

  it('prints the plan, its scope and the allowlist state on --dry-run', async () => {
    const { io } = setup();
    expect(await main(['canary', '--environment', 'Staging', '--dry-run'], io)).toBe(0);
    expect(io.out()).toContain('doctor-canary-c0ffee42');
    expect(io.out()).toContain("will appear in this environment's identities");
    expect(io.out()).toContain("exercises Flagsmith ingestion over HTTP, not your app's SDK instrumentation");
    expect(io.out()).toContain('POST https://events.api.flagsmith.com/v1/events');
    expect(io.out()).toContain('not allowlisted');
    expect(io.fetches).toHaveLength(0);
  });

  it('refuses an environment that is not allowlisted, even with --yes', async () => {
    const { io } = setup({ fetch: accepted });
    expect(await main(['canary', '--environment', 'Staging', '--yes'], io)).toBe(2);
    expect(io.err()).toMatch(/not on the allowlist/);
    expect(io.fetches).toHaveLength(0);
  });

  it('accepts the allowlist from .experiment-doctor.json', async () => {
    const { dir, io } = setup({ fetch: accepted });
    writeFileSync(join(dir, '.experiment-doctor.json'), JSON.stringify({ allowMutations: ['staging'] }));
    expect(await main(['canary', '--environment', 'Staging', '--json'], io)).toBe(0);
    expect(last(io.out()).status).toBe('ACCEPTED');
  });

  it('cancels unless the environment name is typed', async () => {
    const { io } = setup({ answers: ['yes'], fetch: accepted });
    expect(await main(['canary', '--environment', 'Staging', '--allow-env', 'Staging'], io)).toBe(0);
    expect(io.out()).toContain('Cancelled. Nothing was sent.');
    expect(io.fetches).toHaveLength(0);
  });

  it('a production-looking name is not a classification: allowlisting decides, with a warning', async () => {
    const prodEnv = { [`api api/v1/environments/${ENV_KEY}/`]: { name: 'prod', api_key: ENV_KEY } };
    const { io } = setup({ state: prodEnv, fetch: accepted, answers: ['prod'] });
    expect(await main(['canary', '--environment', 'prod'], io)).toBe(2);
    const again = setup({ state: prodEnv, fetch: accepted, answers: ['prod'] });
    expect(await main(['canary', '--environment', 'prod', '--allow-env', ENV_KEY], again.io)).toBe(0);
    expect(again.io.out()).toMatch(/looks like a production environment/);
  });

  it('ACCEPTED, never VERIFIED, when ingestion takes both events', async () => {
    const { io } = setup({ fetch: accepted });
    expect(await main(['canary', '--environment', 'Staging', '--allow-env', 'Staging', '--json'], io)).toBe(0);
    const out = last(io.out());
    expect(out).toMatchObject({ status: 'ACCEPTED', identity: 'doctor-canary-c0ffee42', environment: 'Staging', identityLevel: false, scope: 'ingestion-http' });
    expect(out.message).toMatch(/no identity-level read/);
    const post = io.fetches.find((f) => f.init?.method === 'POST')!;
    expect(post.url).toBe('https://events.api.flagsmith.com/v1/events');
    const body = JSON.parse(String(post.init!.body));
    expect(body.events.map((e: { event: string }) => e.event)).toEqual(['$flag_exposure', 'purchase']);
    expect(body.events[0]).toMatchObject({ feature_name: 'checkout_button', identifier: 'doctor-canary-c0ffee42', value: 'green' });
    expect((post.init!.headers as Record<string, string>)['X-Environment-Key']).toBe(ENV_KEY);
    expect(io.out()).not.toContain(ENV_KEY);
  });

  it('PENDING when ingestion answers 2xx without confirming the count', async () => {
    const { io } = setup({ fetch: (url) => (url.includes('/identities/') ? identityFlags() : new Response('ok', { status: 202 })) });
    expect(await main(['canary', '--environment', 'Staging', '--allow-env', 'Staging'], io)).toBe(0);
    expect(io.out()).toContain('◔ PENDING');
  });

  it('FAILED when the events endpoint does not take the events', async () => {
    const { io } = setup({ fetch: (url) => (url.includes('/identities/') ? identityFlags() : json({ detail: 'This environment does not store events in Flagsmith.' }, 404)) });
    expect(await main(['canary', '--environment', 'Staging', '--allow-env', 'Staging'], io)).toBe(1);
    expect(io.out()).toContain('✕ FAILED');
    expect(io.out()).toMatch(/ED-006 \/ ED-007/);
  });

  it('FAILED when the served variation has no key', async () => {
    const { io } = setup({ fetch: () => identityFlags(true, null) });
    expect(await main(['canary', '--environment', 'Staging', '--allow-env', 'Staging'], io)).toBe(1);
    expect(io.out()).toMatch(/no key/);
  });

  it('PENDING when the canary falls outside the rollout', async () => {
    const { io } = setup({ fetch: () => identityFlags(false) });
    expect(await main(['canary', '--environment', 'Staging', '--allow-env', 'Staging'], io)).toBe(0);
    expect(io.out()).toMatch(/outside the experiment rollout/);
    expect(io.fetches.filter((f) => f.init?.method === 'POST')).toHaveLength(0);
  });
});
