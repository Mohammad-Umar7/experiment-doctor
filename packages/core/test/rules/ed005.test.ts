import { describe, expect, it } from 'vitest';
import { buildContext } from '../../src/rules/context';
import { ed005 } from '../../src/rules/ed005-events-not-flushed';
import { appWith, healthyEvidence } from '../fixtures';

const script = (exitLine: string) => `import Flagsmith from '@flagsmith/nodejs';
const client = new Flagsmith({ environmentKey: process.env.KEY, enableEvents: true });

async function main() {
  for (const id of ids) {
    await client.getExperimentFlag('checkout_button', id);
    client.trackEvent('purchase', { identifier: id });
  }
${exitLine}
}
main();
`;

describe('ED-005 events never flushed', () => {
  it('passes when the browser app flushes on pagehide', () => {
    const out = ed005.run(buildContext(healthyEvidence()));
    expect(out.status).toBe('pass');
    expect(out.note).toMatch(/flushEvents\(\) at src\/flags.ts:17/);
  });

  it('flags a Node script that exits without close() and patches before process.exit', () => {
    const out = ed005.run(buildContext(appWith(script('  process.exit(0);'))));
    expect(out.status).toBe('fail');
    const f = out.findings![0]!;
    expect(f).toMatchObject({ id: 'ED-005', severity: 'critical', layer: 'transport', node: 'sdk' });
    expect(f.fix.patch).toEqual({ file: 'src/flags.ts', line: 9, before: '  process.exit(0);', after: '  await client.close();\n  process.exit(0);' });
  });

  it('passes a Node script that closes the client', () => {
    expect(ed005.run(buildContext(appWith(script('  await client.close();\n  process.exit(0);')))).status).toBe('pass');
  });

  it('flags a serverless handler with no flush', () => {
    const ev = appWith(`import Flagsmith from '@flagsmith/nodejs';
const client = new Flagsmith({ environmentKey: KEY, enableEvents: true });
export async function POST(req) {
  client.trackEvent('purchase', { identifier: req.userId });
  return Response.json({ ok: true });
}`);
    const f = ed005.run(buildContext(ev)).findings![0]!;
    expect(f.title).toMatch(/function returns/);
  });

  it('keeps the browser timer case advisory', () => {
    const out = ed005.run(
      buildContext(
        appWith(`import flagsmith from '@flagsmith/flagsmith';
export async function go(user) {
  await flagsmith.identify(user.id);
  flagsmith.getExperimentFlag('checkout_button');
  flagsmith.trackEvent('purchase');
  document.title = 'x';
}`),
      ),
    );
    expect(out.status).toBe('pass');
    expect(out.findings![0]!.severity).toBe('info');
  });
});
