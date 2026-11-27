import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from '../src/main';
import { APP_FILES, ENV_KEY, fakeIo, flagsmithState, tempDir } from './helpers';

describe('check', () => {
  it('collects config through the Flagsmith CLI, scans code and finds the case mismatch', async () => {
    const dir = tempDir(APP_FILES);
    const io = fakeIo({ cwd: dir, flagsmith: flagsmithState() });
    const code = await main(['check', '--json'], io);
    expect(code).toBe(1);
    const out = JSON.parse(io.out());
    expect(out).toMatchObject({ v: 1, verdict: 'REPAIR_REQUIRED', next: 'experiment-doctor fix' });
    expect(out.primary.id).toBe('ED-004');
    expect(out.primary.fix.patch.after).toBe("  flagsmith.trackEvent('purchase');");
    expect(out.pipeline).toEqual({ app: 'broken', sdk: 'ok', flagsmith: 'ok', warehouse: 'ok', results: 'ok' });
    // read-only: every call is a GET through `flagsmith api` (no -X, no --input)
    for (const call of io.calls) expect(call.args).not.toContain('-X');
    expect(io.calls.some((c) => c.input !== undefined)).toBe(false);
  });

  it('never prints or saves the environment key', async () => {
    const dir = tempDir(APP_FILES);
    const io = fakeIo({ cwd: dir, flagsmith: flagsmithState() });
    await main(['check', '--report', 'r.html'], io);
    expect(io.out()).not.toContain(ENV_KEY);
    expect(readFileSync(join(dir, '.experiment-doctor', 'last-report.json'), 'utf8')).not.toContain(ENV_KEY);
    expect(readFileSync(join(dir, 'r.html'), 'utf8')).not.toContain(ENV_KEY);
  });

  it('explains how to install the Flagsmith CLI and still runs code checks', async () => {
    const dir = tempDir(APP_FILES);
    const io = fakeIo({ cwd: dir, flagsmith: null });
    const code = await main(['check'], io);
    expect(code).toBe(0);
    expect(io.out()).toContain('Flagsmith CLI not found');
    expect(io.out()).toContain('curl -fsSL https://get.flagsmith.com | sh');
    expect(io.out()).toContain('UNVERIFIABLE');
    expect(io.out()).toMatch(/Flagsmith ─+ Warehouse/);
  });

  it('explains how to log in when the CLI is not authenticated', async () => {
    const dir = tempDir(APP_FILES);
    const io = fakeIo({
      cwd: dir,
      flagsmith: flagsmithState({ [`api api/v1/environments/${ENV_KEY}/`]: { __result: { code: 1, stdout: '', stderr: 'not logged in. Run `flagsmith login`, or set FLAGSMITH_API_KEY' } } }),
    });
    await main(['check', '--json'], io);
    const out = JSON.parse(io.out());
    expect(out.notes.join(' ')).toMatch(/Run `flagsmith login`/);
    expect(out.pipeline.flagsmith).toBe('unknown');
  });

  it('asks for an environment when there is no flagsmith.json', async () => {
    const { 'flagsmith.json': _omit, ...files } = APP_FILES;
    const dir = tempDir(files);
    const io = fakeIo({ cwd: dir, flagsmith: flagsmithState() });
    await main(['check', '--json'], io);
    expect(JSON.parse(io.out()).notes[0]).toMatch(/flagsmith init/);
  });

  it('runs offline from an evidence file and writes a JSON report', async () => {
    const dir = tempDir(APP_FILES);
    const io = fakeIo({ cwd: dir, flagsmith: flagsmithState() });
    await main(['check', '--save-evidence', 'ev.json', '--no-save'], io);
    expect(existsSync(join(dir, '.experiment-doctor'))).toBe(false);
    const offline = fakeIo({ cwd: dir, flagsmith: null });
    const code = await main(['check', '--evidence', 'ev.json', '--report', 'out/report.json', '--json'], offline);
    expect(code).toBe(1);
    expect(offline.calls).toHaveLength(0);
    const report = JSON.parse(readFileSync(join(dir, 'out', 'report.json'), 'utf8'));
    expect(report).toMatchObject({ schemaVersion: 1, verdict: 'REPAIR_REQUIRED' });
    expect(report.primaryFinding.id).toBe('ED-004');
  });

  it('prints plain text without escape codes when NO_COLOR is set', async () => {
    const dir = tempDir(APP_FILES);
    const io = fakeIo({ cwd: dir, flagsmith: flagsmithState(), env: { NO_COLOR: '1', FORCE_COLOR: '1' } });
    await main(['check'], io);
    // eslint-disable-next-line no-control-regex
    expect(io.out()).not.toMatch(/\x1b\[/);
    expect(io.out()).toContain('✕ REPAIR REQUIRED');
    expect(io.out()).toContain("- " + "  flagsmith.trackEvent('Purchase');");
  });

  it('rejects unknown options with a usage error', async () => {
    const io = fakeIo({ cwd: tempDir() });
    expect(await main(['check', '--bogus'], io)).toBe(2);
    expect(io.err()).toMatch(/Unknown option/);
  });
});
