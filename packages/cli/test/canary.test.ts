import { describe, expect, it } from 'vitest';
import { main } from '../src/main';
import { APP_FILES, ENV_KEY, fakeIo, flagsmithState, tempDir } from './helpers';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const identityFlags = (inExperiment = true, variant: string | null = 'green') =>
  json({ flags: [{ feature: { id: 7, name: 'checkout_button' }, enabled: true, feature_state_value: 'green', ...(variant ? { variant } : {}), metadata: { experiment: { id: 42, name: 'Checkout button', in_experiment: inExperiment } } }] });

function setup(opts: { fetch?: (url: string, init?: RequestInit) => Response; answers?: string[]; state?: Record<string, unknown>; after?: number } = {}) {
  const dir = tempDir(APP_FILES);
  const state = flagsmithState({
    'environment get Staging --json': { name: 'Staging', api_key: ENV_KEY },
    'environment get prod --json': { name: 'prod', api_key: ENV_KEY },
    ...opts.state,
  });
  let polls = 0;
  const key = `api api/v1/environments/${ENV_KEY}/warehouse-connections/`;
  const before = state[key];
  // after the probe is sent, the warehouse count goes up
  const flagsmith = new Proxy(state, {
    get(t, p: string) {
      if (p === key && opts.after !== undefined && polls++ > 0) return [{ ...(before as object[])[0], total_events_received: opts.after }];
      return t[p];
    },
    has: (t, p) => p in t,
  });
  return { dir, io: fakeIo({ cwd: dir, flagsmith, answers: opts.answers ?? ['Staging'], fetch: opts.fetch }) };
}

describe('canary', () => {
  it('needs an environment the user names', async () => {
    const { io } = setup();
    expect(await main(['canary'], io)).toBe(2);
    expect(io.err()).toMatch(/--environment/);
  });

  it('prints the plan and stops on --dry-run', async () => {
    const { io } = setup();
    expect(await main(['canary', '--environment', 'Staging', '--dry-run'], io)).toBe(0);
    expect(io.out()).toContain('doctor-canary-c0ffee42');
    expect(io.out()).toContain("will appear in this environment's identities");
    expect(io.out()).toContain('POST https://events.api.flagsmith.com/v1/events');
    expect(io.fetches).toHaveLength(0);
  });

  it('cancels unless the environment name is typed', async () => {
    const { io } = setup({ answers: ['yes'] });
    expect(await main(['canary', '--environment', 'Staging'], io)).toBe(0);
    expect(io.out()).toContain('Cancelled. Nothing was sent.');
    expect(io.fetches).toHaveLength(0);
  });

  it('refuses production-looking environments', async () => {
    const { io } = setup({ state: { [`api api/v1/environments/${ENV_KEY}/`]: { name: 'prod', api_key: ENV_KEY } } });
    expect(await main(['canary', '--environment', 'prod'], io)).toBe(2);
    expect(io.err()).toMatch(/looks like production/);
  });

  it('VERIFIED when the events reach the warehouse', async () => {
    const { io } = setup({
      after: 122,
      fetch: (url) => (url.includes('/identities/') ? identityFlags() : json({ accepted: 2, rejected: [] }, 202)),
    });
    expect(await main(['canary', '--environment', 'Staging', '--json'], io)).toBe(0);
    const out = JSON.parse(io.out().trim().split('\n').pop()!);
    expect(out).toMatchObject({ status: 'VERIFIED', identity: 'doctor-canary-c0ffee42', environment: 'Staging' });
    const post = io.fetches.find((f) => f.init?.method === 'POST')!;
    expect(post.url).toBe('https://events.api.flagsmith.com/v1/events');
    const body = JSON.parse(String(post.init!.body));
    expect(body.events.map((e: { event: string }) => e.event)).toEqual(['$flag_exposure', 'purchase']);
    expect(body.events[0]).toMatchObject({ feature_name: 'checkout_button', identifier: 'doctor-canary-c0ffee42', value: 'green' });
    expect((post.init!.headers as Record<string, string>)['X-Environment-Key']).toBe(ENV_KEY);
    expect(io.out()).not.toContain(ENV_KEY);
  });

  it('PENDING, not FAILED, when accepted but not visible yet', async () => {
    const { io } = setup({ fetch: (url) => (url.includes('/identities/') ? identityFlags() : json({ accepted: 2, rejected: [] }, 202)) });
    expect(await main(['canary', '--environment', 'Staging', '--wait', '20'], io)).toBe(0);
    expect(io.out()).toContain('◔ PENDING');
    expect(io.out()).toMatch(/Processing can take minutes/);
  });

  it('FAILED when the events endpoint does not take the events', async () => {
    const { io } = setup({ fetch: (url) => (url.includes('/identities/') ? identityFlags() : json({ detail: 'This environment does not store events in Flagsmith.' }, 404)) });
    expect(await main(['canary', '--environment', 'Staging'], io)).toBe(1);
    expect(io.out()).toContain('✕ FAILED');
    expect(io.out()).toMatch(/ED-006 \/ ED-007/);
  });

  it('FAILED when the served variation has no key', async () => {
    const { io } = setup({ fetch: () => identityFlags(true, null) });
    expect(await main(['canary', '--environment', 'Staging'], io)).toBe(1);
    expect(io.out()).toMatch(/no key/);
  });

  it('PENDING when the canary falls outside the rollout', async () => {
    const { io } = setup({ fetch: () => identityFlags(false) });
    expect(await main(['canary', '--environment', 'Staging'], io)).toBe(0);
    expect(io.out()).toMatch(/outside the experiment rollout/);
    expect(io.fetches.filter((f) => f.init?.method === 'POST')).toHaveLength(0);
  });
});
