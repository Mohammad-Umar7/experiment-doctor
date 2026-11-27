/**
 * Regression tests for false positives seen when running code-only checks on
 * real repositories. Every fixture here is synthetic: it reproduces the
 * pattern, not anybody's code.
 */
import { describe, expect, it } from 'vitest';
import { diagnose } from '../src/diagnose';
import { buildContext } from '../src/rules/context';
import { ed002 } from '../src/rules/ed002-no-identify';
import { ed003 } from '../src/rules/ed003-identity-mismatch';
import { ed006 } from '../src/rules/ed006-events-endpoint';
import { scanFiles, skipReason, type SourceFile } from '../src/scanner/scan';
import type { Evidence } from '../src/types';

const codeOnly = (files: SourceFile[], flag?: string): Evidence => ({
  schemaVersion: 1,
  collectedAt: '2026-11-28T10:00:00Z',
  ...(flag ? { target: { flag } } : {}),
  config: null,
  code: scanFiles(files),
});

const pkg = (name: string) => JSON.stringify({ name, dependencies: { '@flagsmith/flagsmith': '^12.6.0' } }, null, 2);

const goodApp = `import flagsmith from '@flagsmith/flagsmith';
export async function start(user: { id: string }) {
  await flagsmith.init({
    environmentID: ENV,
    enableEvents: true,
  });
  await flagsmith.identify(user.id);
  return flagsmith.getExperimentFlag('hero_copy');
}
window.addEventListener('pagehide', () => flagsmith.flushEvents());
`;

describe('1) test and fixture code is not app code', () => {
  const testFile = `import flagsmith from '@flagsmith/flagsmith';
it('renders the flags tab', async () => {
  await flagsmith.init({ environmentID: 'test-env', defaultFlags: {} });
  expect(flagsmith.getValue('hero_copy')).toBe('a');
});`;

  it('skips *.test.*, *.spec.*, __tests__/, test/, tests/, e2e/, __mocks__/ and fixtures/', () => {
    for (const p of ['src/a.test.ts', 'src/a.spec.tsx', 'src/__tests__/a.ts', 'packages/x/test/flags-tab.test.ts', 'tests/a.ts', 'e2e/a.ts', '__mocks__/flagsmith.ts', 'src/fixtures/app.ts']) {
      expect(skipReason(p, 'const a = 1;')).toBe('test');
    }
    expect(skipReason('src/latest/contest.ts', 'const a = 1;')).toBeNull();
  });

  it('an init without enableEvents inside a test does not fire ED-009', () => {
    const ev = codeOnly([
      { path: 'package.json', content: pkg('web') },
      { path: 'src/flags.ts', content: goodApp },
      { path: 'packages/ui/test/flags-tab.test.ts', content: testFile },
    ]);
    expect(ev.code!.inits).toHaveLength(1);
    expect(ev.code!.skipped).toEqual([{ file: 'packages/ui/test/flags-tab.test.ts', reason: 'test' }]);
    const report = diagnose(ev);
    expect(report.findings.filter((f) => f.id === 'ED-009')).toHaveLength(0);
    expect(report.verdict).not.toBe('REPAIR_REQUIRED');
  });
});

describe('2) minified, vendored and SDK bundles are skipped', () => {
  const sdkCopy = [
    '!function(e){"use strict";var t=function(){};',
    'if(e.eventProcessorConfig&&!e.enableEvents)throw new Error("ValueError: eventProcessorConfig requires enableEvents: true.");',
    'this.getExperimentFlag = function(n){var r=this.getFlag(n);this.trackExposureEvent(n,{value:r});return r};',
    'this.trackEvent=function(n){};this.init=function(o){};',
    '}(window);',
  ].join('\n');

  it('recognises bundles by name, folder, line length and SDK source', () => {
    expect(skipReason('lib/flagsmith.min.js', 'x')).toBe('bundle');
    expect(skipReason('public/demo.js', 'x')).toBe('bundle');
    expect(skipReason('vendor/sdk.js', 'x')).toBe('bundle');
    expect(skipReason('src/one-line.js', `var a=${'1+'.repeat(1200)}1;`)).toBe('minified');
    expect(skipReason('src/sdk-copy.js', sdkCopy)).toBe('sdk-copy');
    expect(skipReason('src/app.ts', goodApp)).toBeNull();
  });

  it('a bundled SDK copy produces no evidence and no findings', () => {
    const ev = codeOnly([
      { path: 'package.json', content: pkg('site') },
      { path: 'src/flags.ts', content: goodApp },
      { path: 'public/demo.js', content: sdkCopy },
      { path: 'assets/flagsmith-copy.js', content: sdkCopy },
    ]);
    expect(ev.code!.skipped!.map((s) => s.reason)).toEqual(['sdk-copy', 'bundle']);
    expect(ev.code!.inits).toHaveLength(1);
    expect(ev.code!.experimentFlags).toHaveLength(1);
    expect(diagnose(ev).verdict).not.toBe('REPAIR_REQUIRED');
  });
});

describe('3) monorepos: never pair calls across apps', () => {
  const app = (identity: string, extra = '') => `import flagsmith from '@flagsmith/flagsmith';
export async function start() {
  await flagsmith.init({
    environmentID: ENV,
    enableEvents: true,
  });
  await flagsmith.identify(${identity});
  const flag = flagsmith.getExperimentFlag('hero_copy');
  ${extra}
  return flag;
}
export function convert() {
  flagsmith.trackEvent('signup');
}
window.addEventListener('pagehide', () => flagsmith.flushEvents());
`;
  const files: SourceFile[] = [
    { path: 'package.json', content: JSON.stringify({ name: 'root', private: true, workspaces: ['apps/*', 'examples/*'] }) },
    { path: 'apps/dashboard/package.json', content: pkg('dashboard') },
    { path: 'apps/dashboard/src/flags.ts', content: app('visitorId()') },
    { path: 'examples/demo-app/package.json', content: pkg('demo-app') },
    { path: 'examples/demo-app/src/flags.ts', content: app('getVisitorId()') },
  ];

  it('records one app root per package.json', () => {
    expect(scanFiles(files).appRoots).toEqual(['', 'apps/dashboard', 'examples/demo-app']);
  });

  it('two apps with different identity helpers are not an identity mismatch', () => {
    const ctx = buildContext(codeOnly(files));
    expect(ctx.app).toMatchObject({ path: 'apps/dashboard', otherApps: ['examples/demo-app'] });
    expect(ed003.run(ctx).status).toBe('pass');
    const report = diagnose(codeOnly(files));
    expect(report.findings.filter((f) => f.id === 'ED-003')).toHaveLength(0);
    expect(report.target).toMatchObject({ app: 'apps/dashboard', otherApps: ['examples/demo-app'] });
    expect(report.verdict).not.toBe('REPAIR_REQUIRED');
  });

  it('picks the app that reads the experiment flag under test', () => {
    const withFlag = files.map((f) => (f.path === 'examples/demo-app/src/flags.ts' ? { ...f, content: f.content.replace("'hero_copy'", "'pricing_v2'") } : f));
    expect(buildContext(codeOnly(withFlag, 'pricing_v2')).app!.path).toBe('examples/demo-app');
  });

  it('still finds a real mismatch inside one app', () => {
    const mixed = [
      { path: 'package.json', content: pkg('one') },
      { path: 'src/flags.ts', content: app('user.id') },
      { path: 'src/checkout.ts', content: `import flagsmith from '@flagsmith/flagsmith';\nexport async function buy(user) {\n  await flagsmith.identify(user.email);\n  flagsmith.trackEvent('signup');\n}` },
    ];
    expect(ed003.run(buildContext(codeOnly(mixed))).status).toBe('fail');
  });
});

describe('4) options built elsewhere are unknown, not missing', () => {
  it('ED-006 does not assume Cloud events when the options contain a spread', () => {
    const ev = codeOnly([
      { path: 'package.json', content: pkg('web') },
      {
        path: 'src/flags.ts',
        content: `import flagsmith from '@flagsmith/flagsmith';
import { baseOptions } from './options';
export async function start(id: string) {
  await flagsmith.init({
    ...baseOptions,
    api: 'https://flags.example.test/api/v1/',
    enableEvents: true,
  });
  await flagsmith.identify(id);
  return flagsmith.getExperimentFlag('hero_copy');
}`,
      },
    ]);
    const out = ed006.run(buildContext(ev));
    expect(out.status).toBe('skip');
    expect(out.note).toMatch(/built elsewhere/);
  });

  it('ED-006 still checks fully visible options', () => {
    const ev = codeOnly([
      { path: 'package.json', content: pkg('web') },
      { path: 'src/flags.ts', content: goodApp.replace('    enableEvents: true,', "    api: 'http://localhost:8000/api/v1/',\n    enableEvents: true,") },
    ]);
    expect(ed006.run(buildContext(ev)).status).toBe('fail');
  });

  it('ED-002 does not claim "never identifies" when the provider options are built elsewhere', () => {
    const ev = codeOnly([
      { path: 'package.json', content: pkg('web') },
      {
        path: 'src/main.tsx',
        content: `import flagsmith from '@flagsmith/flagsmith';
import { FlagsmithProvider, useExperiment } from '@flagsmith/flagsmith/react';
const Hero = () => { const f = useExperiment('hero_copy'); return <h1>{f?.value}</h1>; };
export const Root = () => (
  <FlagsmithProvider flagsmith={flagsmith} options={providerOptions(session)}>
    <Hero />
  </FlagsmithProvider>
);`,
      },
    ]);
    expect(ev.code!.inits[0]).toMatchObject({ style: 'provider', opaque: true });
    const out = ed002.run(buildContext(ev));
    expect(out.status).toBe('skip');
    expect(diagnose(ev).verdict).not.toBe('REPAIR_REQUIRED');
  });
});
