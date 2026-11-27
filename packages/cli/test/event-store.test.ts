import { describe, expect, it } from 'vitest';
import { describeEventStore, parseEventStore, readIdentityEvents } from '../src/event-store';
import { main } from '../src/main';
import type { RunResult } from '../src/io';
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

const EXPOSED = '$flag_exposure\tcheckout_button\t2026-11-28T10:00:00.000Z\tgreen';
const BOUGHT = 'purchase\t\t2026-11-28T10:00:01.000Z\t';

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
    expect(read).toMatchObject({ ok: true, rows: [{ event: '$flag_exposure' }, { event: 'purchase' }] });
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
    return { code, out: JSON.parse(io.out().trim().split('\n').pop()!) };
  };

  it('VERIFIED only when the canary identity has its exposure then its conversion stored', async () => {
    const { code, out } = await run({ 'doctor-canary-c0ffee42': [EXPOSED, BOUGHT] });
    expect(code).toBe(0);
    expect(out).toMatchObject({ status: 'VERIFIED', identityLevel: true, scope: 'ingestion-http' });
  });

  it('FAILED when the stored events do not complete the pipeline', async () => {
    const { code, out } = await run({ 'doctor-canary-c0ffee42': [EXPOSED] });
    expect(code).toBe(1);
    expect(out.status).toBe('FAILED');
  });

  it('PENDING when nothing is stored before the wait ends', async () => {
    const { out } = await run({});
    expect(out).toMatchObject({ status: 'PENDING', identityLevel: false });
  });
});

describe('verify --event-store --identity', () => {
  it('reports PIPELINE_VERIFIED from a real user identity, separately from the patch', async () => {
    const dir = tempDir(APP_FILES);
    await main(['check'], fakeIo({ cwd: dir, flagsmith: flagsmithState() }));
    const io = fakeIo({ cwd: dir, flagsmith: flagsmithState(), process: dockerLab({ 'user-7': [EXPOSED, BOUGHT] }) });
    expect(await main(['verify', '--event-store', 'docker:doctor-lab', '--identity', 'user-7', '--json'], io)).toBe(1);
    const out = JSON.parse(io.out());
    expect(out.patch.status).toBe('PATCH_FAILED');
    expect(out.pipeline).toMatchObject({ status: 'PIPELINE_VERIFIED', probe: { identity: 'user-7', scope: 'app-sdk', identityLevel: true } });
  });

  it('reports PIPELINE_FAILED when the stored conversion has the wrong name', async () => {
    const dir = tempDir(APP_FILES);
    await main(['check'], fakeIo({ cwd: dir, flagsmith: flagsmithState() }));
    const io = fakeIo({ cwd: dir, flagsmith: flagsmithState(), process: dockerLab({ 'user-8': [EXPOSED, 'Purchase\t\t2026-11-28T10:00:01.000Z\t'] }) });
    await main(['verify', '--event-store', 'docker:doctor-lab', '--identity', 'user-8', '--json'], io);
    expect(JSON.parse(io.out()).pipeline.status).toBe('PIPELINE_FAILED');
  });

  it('needs both flags together', async () => {
    const io = fakeIo({ cwd: tempDir() });
    expect(await main(['verify', '--identity', 'u'], io)).toBe(2);
  });
});
