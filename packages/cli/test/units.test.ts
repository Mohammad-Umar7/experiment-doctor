import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { colorEnabled, makePalette } from '../src/color';
import { applyPatch, renderDiff } from '../src/patch';
import { looksLikeEnvKey, looksLikeProduction, splitCommand } from '../src/safety';
import { tempDir } from './helpers';

describe('applyPatch', () => {
  it('keeps CRLF line endings', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'a.ts'), 'one\r\ntwo\r\nthree\r\n');
    expect(applyPatch(dir, { file: 'a.ts', line: 2, before: 'two', after: 'TWO\ninserted' })).toMatchObject({ ok: true });
    expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toBe('one\r\nTWO\r\ninserted\r\nthree\r\n');
  });

  it('refuses paths outside the root', () => {
    const dir = tempDir();
    expect(applyPatch(dir, { file: '../evil.ts', line: 1, before: '', after: 'x' })).toMatchObject({ ok: false });
  });

  it('renders context, removals and additions', () => {
    const c = makePalette({ NO_COLOR: '1' }, true);
    const d = renderDiff({ file: 'a.ts', line: 3, before: '  open({', after: '  open({\n    enableEvents: true,', placeholder: true }, c);
    expect(d).toContain('    open({');
    expect(d).toContain('+     enableEvents: true,');
    expect(d).toContain('placeholder');
  });
});

describe('safety', () => {
  it('spots production-looking environment names (a warning only, never authorization)', () => {
    for (const n of ['Production', 'prod', 'prod-eu', 'Live', 'PRD']) expect(looksLikeProduction(n)).toBe(true);
    for (const n of ['Staging', 'Development', 'qa', 'product-team-sandbox']) expect(looksLikeProduction(n)).toBe(false);
  });

  it('tells keys from names', () => {
    expect(looksLikeEnvKey('aB3dE5fG7hJ9kL1mN3pQ5r')).toBe(true);
    expect(looksLikeEnvKey('Staging')).toBe(false);
  });

  it('splits commands without a shell', () => {
    expect(splitCommand(`flagsmith api x --jq '.[] | {a}' -X POST`)).toEqual(['flagsmith', 'api', 'x', '--jq', '.[] | {a}', '-X', 'POST']);
    expect(splitCommand('a "b c" \'\'')).toEqual(['a', 'b c', '']);
  });
});

describe('color', () => {
  it('respects NO_COLOR, FORCE_COLOR and TTY', () => {
    expect(colorEnabled({ NO_COLOR: '1', FORCE_COLOR: '1' }, true)).toBe(false);
    expect(colorEnabled({ FORCE_COLOR: '1' }, false)).toBe(true);
    expect(colorEnabled({}, false)).toBe(false);
    expect(colorEnabled({}, true)).toBe(true);
    expect(makePalette({ COLORTERM: 'truecolor' }, true).healthy('x')).toBe('\x1b[38;2;34;255;136mx\x1b[39m');
  });
});

describe('mutation allowlist', () => {
  it('fails closed', async () => {
    const { authorizeMutation, loadPolicy } = await import('../src/safety');
    const dir = tempDir();
    expect(authorizeMutation(loadPolicy(dir), { name: 'Staging', key: 'k'.repeat(22) })).toMatchObject({ ok: false });
    expect(authorizeMutation(loadPolicy(dir, ['staging']), { name: 'Staging' })).toMatchObject({ ok: true, matched: 'name' });
    expect(authorizeMutation(loadPolicy(dir, ['Staging']), {})).toMatchObject({ ok: false });
    expect(authorizeMutation(loadPolicy(dir, ['Live']), { name: 'Live' })).toMatchObject({ ok: true, warning: expect.stringMatching(/production/) });
  });

  it('reads .experiment-doctor.json and treats a broken file as allowing nothing', async () => {
    const { authorizeMutation, loadPolicy } = await import('../src/safety');
    const ok = tempDir({ '.experiment-doctor.json': JSON.stringify({ allowMutations: ['abcdefghijklmnopqrstuv'] }) });
    expect(authorizeMutation(loadPolicy(ok), { name: 'Dev', key: 'abcdefghijklmnopqrstuv' })).toMatchObject({ ok: true, matched: 'key' });
    const bad = tempDir({ '.experiment-doctor.json': '{ nope' });
    expect(authorizeMutation(loadPolicy(bad, ['Dev']), { name: 'Dev' })).toMatchObject({ ok: false });
  });
});

describe('patch targets', () => {
  it('refuses a target that resolves outside the root through a link', async () => {
    const { mkdirSync, symlinkSync } = await import('node:fs');
    const outside = tempDir({ 'victim.ts': 'secret\n' });
    const root = tempDir({ 'src/a.ts': 'x\n' });
    mkdirSync(join(root, 'lib'), { recursive: true });
    symlinkSync(outside, join(root, 'lib', 'linked'), 'junction');
    const res = applyPatch(root, { file: 'lib/linked/victim.ts', line: 1, before: 'secret', after: 'pwned' });
    expect(res).toMatchObject({ ok: false });
    expect(readFileSync(join(outside, 'victim.ts'), 'utf8')).toBe('secret\n');
    expect(applyPatch(root, { file: 'src/a.ts', line: 1, before: 'x', after: 'y' })).toMatchObject({ ok: true });
  });
});
