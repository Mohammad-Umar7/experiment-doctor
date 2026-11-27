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
  it('spots production-looking environment names', () => {
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
