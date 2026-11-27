import { describe, expect, it } from 'vitest';
import { scanFiles } from '../src/scanner/scan';

const browserApp = `import flagsmith from '@flagsmith/flagsmith';

export async function start(user) {
  await flagsmith.init({
    environmentID: 'aB3dE5fG7hJ9kL1mN3pQ5r',
    enableEvents: true,
  });
  await flagsmith.identify(user.id);
  const flag = flagsmith.getExperimentFlag('checkout_button');
  return flag?.value;
}

export function onPurchase() {
  // flagsmith.trackEvent('commented_out');
  flagsmith.trackEvent('purchase');
}

window.addEventListener('pagehide', () => {
  flagsmith.flushEvents();
});
`;

const nodeScript = `import Flagsmith from '@flagsmith/nodejs';

const EVENT = 'checkout_completed';
const client = new Flagsmith({
  environmentKey: process.env.FLAGSMITH_KEY,
  apiUrl: 'http://localhost:8000/api/v1/',
  enableEvents: true,
});

async function main() {
  for (const user of users) {
    const flag = await client.getExperimentFlag('pricing_page', user.id);
    if (flag.value === 'b') client.trackEvent(EVENT, { identifier: user.email });
  }
  process.exit(0);
}
main();
`;

const pkg = JSON.stringify({ name: 'app', dependencies: { '@flagsmith/flagsmith': '^12.6.0', react: '19.0.0' } }, null, 2);

describe('scanFiles', () => {
  it('extracts browser SDK usage with line numbers', () => {
    const ev = scanFiles([
      { path: 'src/app.ts', content: browserApp },
      { path: 'package.json', content: pkg },
    ]);
    expect(ev.packages).toEqual([expect.objectContaining({ name: '@flagsmith/flagsmith', range: '^12.6.0', kind: 'js', installed: null })]);
    expect(ev.inits).toHaveLength(1);
    expect(ev.inits[0]).toMatchObject({ sdk: 'js', style: 'init', enableEvents: 'true', apiUrl: null, eventsApiUrl: null });
    expect(ev.identifies).toEqual([expect.objectContaining({ expr: 'user.id', awaited: true, via: 'identify', loc: expect.objectContaining({ line: 8 }) })]);
    expect(ev.experimentFlags).toEqual([expect.objectContaining({ flag: 'checkout_button', method: 'getExperimentFlag', sdk: 'js' })]);
    expect(ev.trackEvents.map((t) => t.event)).toEqual(['purchase']);
    expect(ev.trackEvents[0]!.loc.line).toBe(15);
    expect(ev.flushes).toEqual([expect.objectContaining({ method: 'flushEvents', inExitHandler: true })]);
    expect(ev.files[0]).toMatchObject({ file: 'src/app.ts', runtime: 'browser' });
  });

  it('never stores environment keys in snippets', () => {
    const ev = scanFiles([{ path: 'src/app.ts', content: browserApp }]);
    expect(JSON.stringify(ev)).not.toContain('aB3dE5fG7hJ9kL1mN3pQ5r');
  });

  it('extracts Node SDK usage, constants and identifiers', () => {
    const ev = scanFiles([{ path: 'scripts/simulate.ts', content: nodeScript }]);
    expect(ev.inits[0]).toMatchObject({ sdk: 'node', style: 'constructor', apiUrl: "'http://localhost:8000/api/v1/'", eventsApiUrl: null, client: 'client' });
    expect(ev.experimentFlags[0]).toMatchObject({ flag: 'pricing_page', sdk: 'node', identifierExpr: 'user.id' });
    expect(ev.trackEvents[0]).toMatchObject({ event: 'checkout_completed', identifierExpr: 'user.email', sdk: 'node' });
    expect(ev.exits.map((e) => e.kind)).toEqual(['process.exit']);
    expect(ev.files[0]!.runtime).toBe('node-script');
    expect(ev.flushes).toHaveLength(0);
  });

  it('finds plain flag reads and React hooks', () => {
    const ev = scanFiles([
      {
        path: 'src/Button.tsx',
        content: `import { useFlags, useFlagsmith } from 'flagsmith/react';
export function Button() {
  const flags = useFlags(['checkout_button']);
  const { trackEvent } = useFlagsmith();
  return <button onClick={() => trackEvent('Purchase')}>{flags.checkout_button.value}</button>;
}`,
      },
    ]);
    expect(ev.plainFlagReads).toEqual([expect.objectContaining({ flag: 'checkout_button', method: 'useFlags' })]);
    expect(ev.trackEvents).toEqual([expect.objectContaining({ event: 'Purchase', sdk: 'js' })]);
    expect(ev.files[0]!.runtime).toBe('react');
  });

  it('reads FlagsmithProvider options and the identity option', () => {
    const ev = scanFiles([
      {
        path: 'src/main.tsx',
        content: `import flagsmith from 'flagsmith';
import { FlagsmithProvider } from 'flagsmith/react';
root.render(
  <FlagsmithProvider
    flagsmith={flagsmith}
    options={{
      environmentID: ENV,
      identity: session.userId,
      enableAnalytics: true,
    }}
  >
    <App />
  </FlagsmithProvider>,
);`,
      },
    ]);
    expect(ev.inits[0]).toMatchObject({ style: 'provider', enableEvents: null, enableAnalytics: 'true', identityExpr: 'session.userId' });
    expect(ev.inits[0]!.insertAfter?.line).toBe(6);
    expect(ev.identifies[0]).toMatchObject({ via: 'init-identity', expr: 'session.userId' });
  });

  it('follows a client exported from another module', () => {
    const ev = scanFiles([
      { path: 'src/lib/flags.ts', content: `import Flagsmith from '@flagsmith/nodejs';\nexport const flags = new Flagsmith({ environmentKey: KEY, enableEvents: true });` },
      { path: 'src/routes/checkout.ts', content: `import { flags } from '../lib/flags';\nexport async function POST(req) {\n  flags.trackEvent('purchase', { identifier: req.userId });\n  await flags.flushEvents();\n  return new Response('ok');\n}` },
    ]);
    expect(ev.trackEvents[0]).toMatchObject({ event: 'purchase', sdk: 'node', identifierExpr: 'req.userId' });
    expect(ev.flushes[0]).toMatchObject({ method: 'flushEvents' });
    expect(ev.files.find((f) => f.file === 'src/routes/checkout.ts')!.runtime).toBe('serverless');
  });

  it('ignores other analytics libraries and node_modules', () => {
    const ev = scanFiles([
      { path: 'src/a.ts', content: `analytics.identify(user.email); posthog.identify(user.id); mixpanel.track('x'); Sentry.init({ dsn });` },
      { path: 'node_modules/foo/index.js', content: `flagsmith.trackEvent('x')` },
    ]);
    expect(ev.identifies).toHaveLength(0);
    expect(ev.inits).toHaveLength(0);
    expect(ev.trackEvents).toHaveLength(0);
    expect(ev.scannedFiles).toBe(1);
  });

  it('uses installed versions from node_modules manifests', () => {
    const ev = scanFiles([
      { path: 'package.json', content: JSON.stringify({ dependencies: { '@flagsmith/nodejs': '^9.0.0' } }) },
      { path: 'node_modules/@flagsmith/nodejs/package.json', content: JSON.stringify({ name: '@flagsmith/nodejs', version: '9.0.4' }) },
    ]);
    expect(ev.packages[0]).toMatchObject({ name: '@flagsmith/nodejs', range: '^9.0.0', installed: '9.0.4' });
  });

  it('notices unawaited identify calls and dynamic event names', () => {
    const ev = scanFiles([
      {
        path: 'src/a.js',
        content: `import flagsmith from '@flagsmith/flagsmith';\nflagsmith.identify(user.id);\nconst f = flagsmith.getExperimentFlag(FLAGS.CHECKOUT);\nflagsmith.trackEvent(name);\nconst FLAGS = { CHECKOUT: 'checkout_v2' };`,
      },
    ]);
    expect(ev.identifies[0]!.awaited).toBe(false);
    expect(ev.experimentFlags[0]!.flag).toBe('checkout_v2');
    expect(ev.trackEvents[0]).toMatchObject({ event: null, raw: 'name' });
  });
});
