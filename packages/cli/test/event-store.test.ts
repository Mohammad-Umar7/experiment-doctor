import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { keyFingerprint } from '@experiment-doctor/core';
import { describe, expect, it } from 'vitest';
import { describeEventStore, parseEventStore, readIdentityEvents } from '../src/event-store';
import { main } from '../src/main';
import type { RunResult } from '../src/io';
import { saveState } from '../src/state';
import { APP_FILES, ENV_KEY, fakeIo, flagsmithState, tempDir } from './helpers';

const ok = (stdout: string): RunResult => ({ code: 0, stdout, stderr: '' });

/** Fakes `docker ps` + `docker exec ... psql`, answering with the rows for the identity in the \set line. */
function dockerLab(store: Record<string, string[]>) {
  return (cmd: string, args: string[], input?: string): RunResult => {
    if (cmd !== 'docker') return { code: 127, stdout: '', stderr: '', notFound: true };
    if (args[0] === 'ps') return ok('doctor-lab-postgres-1\n');
    const identity = /\\set identity (\S+)/.exec(input ?? '')?.[1] ?? '';
    return ok((store[identity] ?? []).join('\n'));
  };
}

// The fake clock starts at 2026-11-27T10:00:00Z; by default these events come after it.
const exposed = (at = '2026-11-27T10:05:00.000Z', experiment = 42) => `$flag_exposure\tcheckout_button\t${at}\tgreen\t{"experiment_id":${experiment}}`;
const bought = (at = '2026-11-27T10:05:01.000Z', name = 'purchase') => `${name}\t\t${at}\t\t{}`;
const EXPOSED = exposed();
const BOUGHT = bought();

describe('event store access', () => {
  it('parses specs and hides passwords', () => {
    expect(parseEventStore('docker:doctor-lab')).toEqual({ kind: 'docker', project: 'doctor-lab', service: 'postgres', db: 'flagsmith', user: 'postgres' });
    expect(parseEventStore('docker:lab/db?db=fs&user=app')).toMatchObject({ service: 'db', db: 'fs', user: 'app' });
    expect(describeEventStore(parseEventStore('psql:postgres://app:s3cret@localhost/flagsmith'))).toBe('psql postgres://app:***@localhost/flagsmith');
    expect(() => parseEventStore('docker:bad name;rm')).toThrow(/invalid project/);
    expect(() => parseEventStore('mysql://x')).toThrow();
  });

  it('passes identity and key as psql variables on stdin, never in argv or SQL', async () => {
    const io = fakeIo({ cwd: tempDir(), process: dockerLab({ 'u-1': [EXPOSED, BOUGHT] }) });
    const read = await readIdentityEvents(io, parseEventStore('docker:doctor-lab'), 'u-1', ENV_KEY);
    expect(read).toMatchObject({ ok: true, rows: [{ event: '$flag_exposure', metadata: '{"experiment_id":42}' }, { event: 'purchase' }] });
    const exec = io.processes.find((p) => p.args[0] === 'exec')!;
    expect(exec.args).toEqual(['exec', '-i', 'doctor-lab-postgres-1', 'psql', '-U', 'postgres', '-d', 'flagsmith', '-At', '-F', '\t', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', '-']);
    expect(exec.args.join(' ')).not.toContain(ENV_KEY);
    expect(exec.input).toContain(`\\set env ${ENV_KEY}`);
    expect(exec.input).toContain("identifier = :'identity'");
  });

  it('rejects identities that are not safe to hand to psql', async () => {
    const io = fakeIo({ cwd: tempDir(), process: dockerLab({}) });
    expect(await readIdentityEvents(io, parseEventStore('docker:doctor-lab'), "x'; drop table t; --", ENV_KEY)).toMatchObject({ ok: false });
    expect(io.processes).toHaveLength(0);
  });
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const flags = () => json({ flags: [{ feature: { name: 'checkout_button' }, enabled: true, variant: 'green', metadata: { experiment: { id: 42, in_experiment: true } } }] });

describe('canary --event-store', () => {
  const run = async (store: Record<string, string[]>) => {
    const dir = tempDir(APP_FILES);
    const io = fakeIo({
      cwd: dir,
      flagsmith: flagsmithState({ 'environment get Staging --json': { name: 'Staging', api_key: ENV_KEY } }),
      fetch: (url) => (url.includes('/identities/') ? flags() : json({ accepted: 2, rejected: [] }, 202)),
      process: dockerLab(store),
    });
    const code = await main(['canary', '--environment', 'Staging', '--allow-env', 'Staging', '--yes', '--event-store', 'docker:doctor-lab', '--wait', '4', '--json'], io);
    return { code, out: JSON.parse(io.out().trim().split('\n').pop()!), dir };
  };

  it('VERIFIED only when the canary identity has its exposure then its conversion stored', async () => {
    const { code, out } = await run({ 'doctor-canary-c0ffee42': [EXPOSED, BOUGHT] });
    expect(code).toBe(0);
    expect(out).toMatchObject({
      status: 'VERIFIED',
      identityLevel: true,
      scope: 'ingestion-http',
      binding: { envFingerprint: keyFingerprint(ENV_KEY), experimentId: 42, flag: 'checkout_button', event: 'purchase' },
      evidenceAt: '2026-11-27T10:05:00.000Z',
    });
  });

  it('does not count events stored before the canary was sent', async () => {
    const { out } = await run({ 'doctor-canary-c0ffee42': [exposed('2026-11-27T09:00:00.000Z'), bought('2026-11-27T09:00:01.000Z')] });
    expect(out.status).toBe('PENDING');
  });

  it('FAILED when the stored conversion has the wrong name', async () => {
    const { code, out } = await run({ 'doctor-canary-c0ffee42': [EXPOSED, bought(undefined, 'Purchase')] });
    expect(code).toBe(1);
    expect(out.status).toBe('FAILED');
  });

  it('PENDING when nothing (or only the exposure) is stored before the wait ends', async () => {
    expect((await run({})).out).toMatchObject({ status: 'PENDING', identityLevel: false });
    expect((await run({ 'doctor-canary-c0ffee42': [EXPOSED] })).out.status).toBe('PENDING');
  });
});

describe('verify --event-store --identity', () => {
  const checked = async () => {
    const dir = tempDir(APP_FILES);
    await main(['check'], fakeIo({ cwd: dir, flagsmith: flagsmithState() }));
    return dir;
  };
  const verify = async (dir: string, store: Record<string, string[]> | null, identity = 'user-7', extra: string[] = []) => {
    const io = fakeIo({ cwd: dir, flagsmith: flagsmithState(), process: store ? dockerLab(store) : undefined });
    const code = await main(['verify', '--event-store', 'docker:doctor-lab', '--identity', identity, '--wait', '0', '--json', ...extra], io);
    return { code, out: JSON.parse(io.out()) };
  };

  it('reports PIPELINE_VERIFIED from a real user identity, separately from the patch', async () => {
    const { code, out } = await verify(await checked(), { 'user-7': [EXPOSED, BOUGHT] });
    expect(code).toBe(1);
    expect(out.patch.status).toBe('PATCH_FAILED');
    expect(out.pipeline).toMatchObject({ status: 'PIPELINE_VERIFIED', probe: { identity: 'user-7', scope: 'app-sdk', identityLevel: true } });
    expect(out.window.reason).toBe('verify-start');
  });

  it('reports PIPELINE_FAILED when the stored conversion has the wrong name', async () => {
    const { out } = await verify(await checked(), { 'user-8': [EXPOSED, bought(undefined, 'Purchase')] }, 'user-8');
    expect(out.pipeline.status).toBe('PIPELINE_FAILED');
  });

  it('never falls back to an earlier canary when the identity cannot be read', async () => {
    const dir = await checked();
    saveState(dir, 'canary.json', {
      at: '2026-11-27T10:30:00.000Z',
      status: 'VERIFIED',
      identity: 'doctor-canary-old',
      identityLevel: true,
      binding: { envFingerprint: keyFingerprint(ENV_KEY), experimentId: 42, flag: 'checkout_button', event: 'purchase', sentAt: '2026-11-27T10:30:00.000Z' },
      evidenceAt: '2026-11-27T10:30:00.000Z',
    });
    const { out } = await verify(dir, null); // docker missing
    expect(out.pipeline.status).toBe('PIPELINE_UNVERIFIED');
    expect(out.pipeline.message).toMatch(/event store could not be read/);
    expect(out.pipeline.probe.identity).toBe('user-7');
    // and an identity with no new events stays unverified too, the canary is not used
    const empty = await verify(dir, {});
    expect(empty.out.pipeline.status).toBe('PIPELINE_UNVERIFIED');
    expect(empty.out.pipeline.probe.identity).toBe('user-7');
  });

  it('ignores events older than the repair, even for the same identity', async () => {
    const dir = await checked();
    writeFileSync(join(dir, '.experiment-doctor', 'last-fix.json'), JSON.stringify({ at: '2026-11-27T12:00:00.000Z', finding: 'ED-004', action: 'patched' }));
    const old = await verify(dir, { 'user-7': [EXPOSED, BOUGHT] });
    expect(old.out.window).toEqual({ since: '2026-11-27T12:00:00.000Z', reason: 'repair' });
    expect(old.out.pipeline.status).toBe('PIPELINE_UNVERIFIED');
    const fresh = await verify(dir, { 'user-7': [EXPOSED, BOUGHT, exposed('2026-11-27T12:01:00.000Z'), bought('2026-11-27T12:01:02.000Z')] });
    expect(fresh.out.pipeline.status).toBe('PIPELINE_VERIFIED');
  });

  it('ignores exposures for another experiment', async () => {
    const { out } = await verify(await checked(), { 'user-7': [exposed(undefined, 7), BOUGHT] });
    expect(out.pipeline.status).toBe('PIPELINE_UNVERIFIED');
    expect(out.notes.join(' ')).toMatch(/belongs to experiment 7, not 42/);
  });

  it('needs both flags together', async () => {
    const io = fakeIo({ cwd: tempDir() });
    expect(await main(['verify', '--identity', 'u'], io)).toBe(2);
  });
});

describe('verify with a saved canary', () => {
  const canary = (over: Record<string, unknown> = {}, binding: Record<string, unknown> = {}) => ({
    at: '2026-11-27T10:30:00.000Z',
    status: 'VERIFIED',
    identity: 'doctor-canary-1',
    identityLevel: true,
    binding: { envFingerprint: keyFingerprint(ENV_KEY), experimentId: 42, flag: 'checkout_button', event: 'purchase', sentAt: '2026-11-27T10:30:00.000Z', ...binding },
    evidenceAt: '2026-11-27T10:30:00.000Z',
    ...over,
  });
  const run = async (saved: unknown, fixedAt?: string) => {
    const dir = tempDir(APP_FILES);
    await main(['check'], fakeIo({ cwd: dir, flagsmith: flagsmithState() }));
    saveState(dir, 'canary.json', saved);
    if (fixedAt) writeFileSync(join(dir, '.experiment-doctor', 'last-fix.json'), JSON.stringify({ at: fixedAt }));
    const io = fakeIo({ cwd: dir, flagsmith: flagsmithState() });
    await main(['verify', '--json'], io);
    return JSON.parse(io.out()).pipeline;
  };

  it('counts a bound canary sent after the repair', async () => {
    expect((await run(canary(), '2026-11-27T10:10:00.000Z')).status).toBe('PIPELINE_VERIFIED');
  });

  it('does not count a canary sent before the repair', async () => {
    const p = await run(canary(), '2026-11-27T11:00:00.000Z');
    expect(p.status).toBe('PIPELINE_UNVERIFIED');
    expect(p.message).toMatch(/older than the repair/);
  });

  it('does not count a canary from before this verify run when nothing was fixed', async () => {
    const p = await run(canary({ at: '2026-11-27T09:00:00.000Z', evidenceAt: '2026-11-27T09:00:00.000Z' }));
    expect(p.message).toMatch(/older than this verify run/);
  });

  it('does not count a canary for another environment or experiment', async () => {
    expect((await run(canary({}, { envFingerprint: keyFingerprint('someOtherEnvironmentKey') }), '2026-11-27T10:10:00.000Z')).message).toMatch(/different environment/);
    expect((await run(canary({}, { experimentId: 9 }), '2026-11-27T10:10:00.000Z')).message).toMatch(/experiment 9, not 42/);
  });
});
