import { cpSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { main } from '../src/main';
import { fakeIo } from './helpers';

const EXAMPLES = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../examples/broken-apps');
const cases = JSON.parse(readFileSync(join(EXAMPLES, 'cases.json'), 'utf8')) as { id: string; expected: string | null; verdict: string }[];

describe('example broken apps', () => {
  it('has at least 8 broken cases and a healthy one', () => {
    expect(cases.filter((c) => c.verdict === 'REPAIR_REQUIRED').length).toBeGreaterThanOrEqual(8);
    expect(cases.some((c) => c.verdict === 'HEALTHY')).toBe(true);
  });

  for (const c of cases) {
    it(`${c.id} -> ${c.expected ?? c.verdict}`, async () => {
      const io = fakeIo({ cwd: EXAMPLES, flagsmith: null });
      await main(['check', '--evidence', join(c.id, 'evidence.json'), '--json', '--no-save'], io);
      const out = JSON.parse(io.out());
      expect(out.verdict).toBe(c.verdict);
      expect(c.expected === null ? null : out.primary?.id).toBe(c.expected);
      expect(io.calls).toHaveLength(0);
    });
  }

  it('repairs a copy of a case and verifies it offline', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ed-case-'));
    cpSync(join(EXAMPLES, '11-plain-flag-read'), dir, { recursive: true });
    const fix = fakeIo({ cwd: dir, flagsmith: null, answers: ['y'] });
    expect(await main(['fix', '--evidence', 'evidence.json'], fix)).toBe(0);
    expect(readFileSync(join(dir, 'src', 'flags.ts'), 'utf8')).toContain('flagsmith.getExperimentFlag(CHECKOUT_FLAG)?.value');
    const verify = fakeIo({ cwd: dir, flagsmith: null });
    await main(['verify', '--json'], verify);
    expect(JSON.parse(verify.out())).toMatchObject({ status: 'VERIFIED', target: 'ED-011' });
  });
});
