import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from '../src/main';
import { APP_FILES, ENV_KEY, fakeIo, flagsmithState, tempDir } from './helpers';

const read = (dir: string) => readFileSync(join(dir, 'src', 'flags.ts'), 'utf8');

describe('fix', () => {
  it('shows the diff and writes nothing on N', async () => {
    const dir = tempDir(APP_FILES);
    const io = fakeIo({ cwd: dir, flagsmith: flagsmithState(), answers: ['n'] });
    expect(await main(['fix'], io)).toBe(0);
    expect(io.out()).toContain("-   flagsmith.trackEvent('Purchase');");
    expect(io.out()).toContain("+   flagsmith.trackEvent('purchase');");
    expect(io.err()).toContain('Apply this change to src/flags.ts? [y/N]');
    expect(io.out()).toContain('Not applied');
    expect(read(dir)).toContain("trackEvent('Purchase')");
  });

  it('applies the patch on y, then verify reports VERIFIED', async () => {
    const dir = tempDir(APP_FILES);
    const io = fakeIo({ cwd: dir, flagsmith: flagsmithState(), answers: ['y'] });
    expect(await main(['fix'], io)).toBe(0);
    expect(read(dir)).toContain("trackEvent('purchase')");
    expect(io.out()).toContain('Patched src/flags.ts:13');

    const v = fakeIo({ cwd: dir, flagsmith: flagsmithState() });
    expect(await main(['verify', '--json'], v)).toBe(0);
    const out = JSON.parse(v.out());
    expect(out).toMatchObject({ status: 'VERIFIED', target: 'ED-004', resolved: ['ED-004'], verdictAfter: 'HEALTHY' });
  });

  it('verify reports FAILED when nothing changed', async () => {
    const dir = tempDir(APP_FILES);
    await main(['check', '--no-save'], fakeIo({ cwd: dir, flagsmith: flagsmithState() }));
    await main(['check'], fakeIo({ cwd: dir, flagsmith: flagsmithState() }));
    const v = fakeIo({ cwd: dir, flagsmith: flagsmithState() });
    expect(await main(['verify'], v)).toBe(1);
    expect(v.out()).toContain('✕ FAILED');
  });

  it('verify reports PENDING when the evidence is gone', async () => {
    const dir = tempDir(APP_FILES);
    await main(['fix', '--yes'], fakeIo({ cwd: dir, flagsmith: flagsmithState() }));
    const v = fakeIo({ cwd: dir, flagsmith: null });
    expect(await main(['verify', '--json'], v)).toBe(0);
    expect(JSON.parse(v.out()).status).toBe('PENDING');
  });

  it('refuses a patch when the file changed since the diagnosis', async () => {
    const dir = tempDir(APP_FILES);
    await main(['check', '--save-evidence', 'ev.json', '--no-save'], fakeIo({ cwd: dir, flagsmith: flagsmithState() }));
    writeFileSync(join(dir, 'src', 'flags.ts'), read(dir).replace("trackEvent('Purchase')", "trackEvent('Purchase', {})"));
    const io = fakeIo({ cwd: dir, flagsmith: null });
    expect(await main(['fix', '--evidence', 'ev.json', '--yes'], io)).toBe(1);
    expect(io.out()).toMatch(/changed since the diagnosis/);
  });

  it('runs a config change only after approval, with the key filled in but never printed', async () => {
    const dir = tempDir({ ...APP_FILES, 'src/flags.ts': APP_FILES['src/flags.ts']!.replace("'Purchase'", "'purchase'") });
    const state = flagsmithState();
    const detail = state[`api api/v1/environments/${ENV_KEY}/experiments/42/`] as Record<string, unknown>;
    state[`api api/v1/environments/${ENV_KEY}/experiments/42/`] = { ...detail, status: 'created' };
    state[`api api/v1/environments/${ENV_KEY}/experiments/42/start/ -X POST`] = { id: 42, status: 'running' };
    const io = fakeIo({ cwd: dir, flagsmith: state, answers: ['y'] });
    expect(await main(['fix'], io)).toBe(0);
    expect(io.out()).toContain('flagsmith api api/v1/environments/<env-key>/experiments/42/start/ -X POST');
    expect(io.err()).toContain('Run this against environment "Staging"? [y/N]');
    expect(io.out()).not.toContain(ENV_KEY);
    expect(io.calls.at(-1)!.args).toEqual(['api', `api/v1/environments/${ENV_KEY}/experiments/42/start/`, '-X', 'POST']);
  });

  it('refuses config changes in a production-looking environment', async () => {
    const dir = tempDir({ ...APP_FILES, 'src/flags.ts': APP_FILES['src/flags.ts']!.replace("'Purchase'", "'purchase'") });
    const state = flagsmithState({ [`api api/v1/environments/${ENV_KEY}/`]: { name: 'Production', api_key: ENV_KEY } });
    const detail = state[`api api/v1/environments/${ENV_KEY}/experiments/42/`] as Record<string, unknown>;
    state[`api api/v1/environments/${ENV_KEY}/experiments/42/`] = { ...detail, status: 'paused' };
    const io = fakeIo({ cwd: dir, flagsmith: state, answers: ['y'] });
    expect(await main(['fix'], io)).toBe(3);
    expect(io.out()).toMatch(/looks like production/);
    expect(io.calls.some((c) => c.args.includes('-X'))).toBe(false);
  });

  it('dry-run never writes', async () => {
    const dir = tempDir(APP_FILES);
    const io = fakeIo({ cwd: dir, flagsmith: flagsmithState() });
    await main(['fix', '--dry-run', '--json'], io);
    expect(JSON.parse(io.out().trim().split('\n').pop()!)).toMatchObject({ action: 'dry-run', finding: 'ED-004' });
    expect(read(dir)).toContain("trackEvent('Purchase')");
  });
});
