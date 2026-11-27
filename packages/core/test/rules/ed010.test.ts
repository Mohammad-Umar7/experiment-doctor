import { describe, expect, it } from 'vitest';
import { buildContext } from '../../src/rules/context';
import { ed010 } from '../../src/rules/ed010-sdk-too-old';
import { HEALTHY_APP, healthyEvidence, withFile } from '../fixtures';

const withDeps = (deps: Record<string, string>, extra: { path: string; content: string }[] = []) =>
  healthyEvidence([...withFile('package.json', JSON.stringify({ name: 'shop', dependencies: deps }, null, 2), HEALTHY_APP), ...extra]);

describe('ED-010 SDK too old', () => {
  it('passes for ^12.6.0', () => {
    expect(ed010.run(buildContext(healthyEvidence())).status).toBe('pass');
  });

  it('fails a pinned old JS SDK and patches package.json', () => {
    const f = ed010.run(buildContext(withDeps({ '@flagsmith/flagsmith': '12.3.0' }))).findings![0]!;
    expect(f).toMatchObject({ id: 'ED-010', severity: 'critical' });
    expect(f.fix.patch).toEqual({ file: 'package.json', line: 4, before: '    "@flagsmith/flagsmith": "12.3.0"', after: '    "@flagsmith/flagsmith": "^12.6.0"' });
  });

  it('uses the installed version over the range', () => {
    const ev = withDeps({ '@flagsmith/nodejs': '^9.0.0' }, [
      { path: 'node_modules/@flagsmith/nodejs/package.json', content: '{"name":"@flagsmith/nodejs","version":"9.0.2"}' },
    ]);
    expect(ed010.run(buildContext(ev)).findings![0]!.title).toMatch(/installed 9.0.2/);
  });

  it('is honest when a caret range may or may not be new enough', () => {
    const out = ed010.run(buildContext(withDeps({ '@flagsmith/flagsmith': '^12.0.0' })));
    expect(out.status).toBe('skip');
    expect(out.note).toMatch(/installed version is unknown/);
  });

  it('rejects the old flagsmith-nodejs package', () => {
    const f = ed010.run(buildContext(withDeps({ 'flagsmith-nodejs': '^2.5.2' }))).findings![0]!;
    expect(f.title).toBe('flagsmith-nodejs cannot send experiment events');
    expect(f.fix.patch!.after).toContain('"@flagsmith/nodejs": "^9.5.0"');
  });
});
