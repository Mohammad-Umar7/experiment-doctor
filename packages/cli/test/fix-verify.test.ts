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

  it('applies the patch on y, then verify reports patch, pipeline and experiment separately', async () => {
    const dir = tempDir(APP_FILES);
    const io = fakeIo({ cwd: dir, flagsmith: flagsmithState(), answers: ['y'] });
    expect(await main(['fix'], io)).toBe(0);
    expect(read(dir)).toContain("trackEvent('purchase')");
    expect(io.out()).toContain('Patched src/flags.ts:13');

    const v = fakeIo({ cwd: dir, flagsmith: flagsmithState() });
    expect(await main(['verify', '--json'], v)).toBe(0);
    const out = JSON.parse(v.out());
    expect(out).toMatchObject({
      v: 2,
      patch: { status: 'PATCH_VERIFIED', target: 'ED-004' },
      pipeline: { status: 'PIPELINE_UNVERIFIED' },
      experiment: { status: 'EXPERIMENT_HEALTHY', verdict: 'HEALTHY' },
      resolved: ['ED-004'],
    });
    expect(out.status).toBeUndefined();

    const text = fakeIo({ cwd: dir, flagsmith: flagsmithState() });
    await main(['verify'], text);
    expect(text.out()).toContain('✓ PATCH_VERIFIED');
    expect(text.out()).toContain('? PIPELINE_UNVERIFIED');
    expect(text.out()).toContain('✓ EXPERIMENT_HEALTHY');
  });

  it('verify reports PATCH_FAILED when nothing changed', async () => {
    const dir = tempDir(APP_FILES);
    await main(['check', '--no-save'], fakeIo({ cwd: dir, flagsmith: flagsmithState() }));
    await main(['check'], fakeIo({ cwd: dir, flagsmith: flagsmithState() }));
    const v = fakeIo({ cwd: dir, flagsmith: flagsmithState() });
    expect(await main(['verify'], v)).toBe(1);
    expect(v.out()).toContain('✕ PATCH_FAILED');
  });

  it('verify reports PATCH_UNVERIFIED when the evidence is gone', async () => {
    const dir = tempDir(APP_FILES);
    await main(['check'], fakeIo({ cwd: dir, flagsmith: flagsmithState() }));
    expect(await main(['fix', '--yes'], fakeIo({ cwd: dir, flagsmith: flagsmithState() }))).toBe(0);
    const v = fakeIo({ cwd: dir, flagsmith: null });
    expect(await main(['verify', '--json'], v)).toBe(0);
    expect(JSON.parse(v.out()).patch.status).toBe('PATCH_UNVERIFIED');
  });

  it('refuses a patch when the file changed since the diagnosis', async () => {
    const dir = tempDir(APP_FILES);
    await main(['check', '--save-evidence', 'ev.json', '--no-save'], fakeIo({ cwd: dir, flagsmith: flagsmithState() }));
    await main(['check', '--evidence', 'ev.json'], fakeIo({ cwd: dir, flagsmith: null }));
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
    expect(await main(['fix', '--allow-env', 'Staging'], io)).toBe(0);
    expect(io.out()).toContain('flagsmith api api/v1/environments/<env-key>/experiments/42/start/ -X POST');
    expect(io.err()).toContain('Run this against environment "Staging"? [y/N]');
    expect(io.out()).not.toContain(ENV_KEY);
    expect(io.calls.at(-1)!.args).toEqual(['api', `api/v1/environments/${ENV_KEY}/experiments/42/start/`, '-X', 'POST']);
  });

  it('refuses config changes in any environment that is not allowlisted, even with --yes', async () => {
    const dir = tempDir({ ...APP_FILES, 'src/flags.ts': APP_FILES['src/flags.ts']!.replace("'Purchase'", "'purchase'") });
    const state = flagsmithState();
    const detail = state[`api api/v1/environments/${ENV_KEY}/experiments/42/`] as Record<string, unknown>;
    state[`api api/v1/environments/${ENV_KEY}/experiments/42/`] = { ...detail, status: 'paused' };
    await main(['check'], fakeIo({ cwd: dir, flagsmith: state }));
    const io = fakeIo({ cwd: dir, flagsmith: state });
    expect(await main(['fix', '--yes'], io)).toBe(3);
    expect(io.out()).toMatch(/not on the allowlist/);
    expect(io.calls.some((c) => c.args.includes('-X'))).toBe(false);
  });

  it('allowlisting decides; a production-looking name only adds a warning', async () => {
    const dir = tempDir({ ...APP_FILES, 'src/flags.ts': APP_FILES['src/flags.ts']!.replace("'Purchase'", "'purchase'"), '.experiment-doctor.json': JSON.stringify({ allowMutations: ['Production'] }) });
    const state = flagsmithState({ [`api api/v1/environments/${ENV_KEY}/`]: { name: 'Production', api_key: ENV_KEY } });
    const detail = state[`api api/v1/environments/${ENV_KEY}/experiments/42/`] as Record<string, unknown>;
    state[`api api/v1/environments/${ENV_KEY}/experiments/42/`] = { ...detail, status: 'paused' };
    state[`api api/v1/environments/${ENV_KEY}/experiments/42/start/ -X POST`] = { id: 42, status: 'running' };
    const io = fakeIo({ cwd: dir, flagsmith: state, answers: ['n'] });
    expect(await main(['fix'], io)).toBe(0);
    expect(io.out()).toMatch(/looks like a production environment/);
    expect(io.out()).toContain('Not run. Nothing changed in Flagsmith.');
    expect(io.calls.some((c) => c.args.includes('-X'))).toBe(false);
  });

  it('dry-run never writes', async () => {
    const dir = tempDir(APP_FILES);
    const io = fakeIo({ cwd: dir, flagsmith: flagsmithState() });
    await main(['fix', '--dry-run', '--json'], io);
    expect(JSON.parse(io.out().trim().split('\n').pop()!)).toMatchObject({ action: 'dry-run', finding: 'ED-004' });
    expect(read(dir)).toContain("trackEvent('Purchase')");
  });

  it('--yes applies the same patch the last check showed, then verify binds to the repair time', async () => {
    const dir = tempDir(APP_FILES);
    const check = fakeIo({ cwd: dir, flagsmith: flagsmithState() });
    await main(['check', '--json'], check);
    const shown = JSON.parse(check.out()).primary.fix.patch;
    const io = fakeIo({ cwd: dir, flagsmith: flagsmithState() });
    expect(await main(['fix', '--yes', '--json'], io)).toBe(0);
    expect(JSON.parse(io.out().trim().split('\n').pop()!)).toMatchObject({ action: 'patched', file: shown.file });
    expect(read(dir)).toContain(shown.after.trim());
    const v = fakeIo({ cwd: dir, flagsmith: flagsmithState() });
    await main(['verify', '--json'], v);
    const out = JSON.parse(v.out());
    expect(out.patch.status).toBe('PATCH_VERIFIED');
    expect(out.window.reason).toBe('repair');
  });

  it('--yes refuses without a previous check', async () => {
    const dir = tempDir(APP_FILES);
    const io = fakeIo({ cwd: dir, flagsmith: flagsmithState() });
    expect(await main(['fix', '--yes'], io)).toBe(3);
    expect(io.out()).toMatch(/only applies the change shown by the last check/);
    expect(read(dir)).toContain("trackEvent('Purchase')");
  });

  it('--yes refuses when a fresh diagnosis would apply a different patch', async () => {
    const dir = tempDir(APP_FILES);
    await main(['check'], fakeIo({ cwd: dir, flagsmith: flagsmithState() }));
    // the line moves: the fresh patch targets another line than the one the human saw
    writeFileSync(join(dir, 'src', 'flags.ts'), `// a new header line\n${read(dir)}`);
    const io = fakeIo({ cwd: dir, flagsmith: flagsmithState() });
    expect(await main(['fix', '--yes'], io)).toBe(3);
    expect(io.out()).toMatch(/differs from the one the last check showed \(src\/flags.ts:13\)/);
    expect(read(dir)).toContain("trackEvent('Purchase')");
  });

  it('--yes refuses when the finding to fix changed', async () => {
    const dir = tempDir(APP_FILES);
    await main(['check'], fakeIo({ cwd: dir, flagsmith: flagsmithState() }));
    writeFileSync(join(dir, 'src', 'flags.ts'), read(dir).replace("trackEvent('Purchase')", "trackEvent('purchase')").replace('    enableEvents: true,\n', ''));
    const io = fakeIo({ cwd: dir, flagsmith: flagsmithState() });
    expect(await main(['fix', '--yes'], io)).toBe(3);
    expect(io.out()).toMatch(/changed since the last check \(ED-004 then, ED-009 now\)/);
  });
});
