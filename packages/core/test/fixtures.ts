import { scanFiles, type SourceFile } from '../src/scanner/scan';
import type { ConfigEvidence, Evidence } from '../src/types';

/** A healthy browser app: identify, getExperimentFlag, trackEvent, flush on pagehide. */
export const HEALTHY_APP: SourceFile[] = [
  {
    path: 'package.json',
    content: JSON.stringify({ name: 'shop', dependencies: { '@flagsmith/flagsmith': '^12.6.0' } }, null, 2),
  },
  {
    path: 'src/flags.ts',
    content: `import flagsmith from '@flagsmith/flagsmith';

export async function startFlags(user: { id: string }) {
  await flagsmith.init({
    environmentID: import.meta.env.VITE_FLAGSMITH_ENV,
    enableEvents: true,
  });
  await flagsmith.identify(user.id);
  return flagsmith.getExperimentFlag('checkout_button');
}

export function trackPurchase() {
  flagsmith.trackEvent('purchase');
}

window.addEventListener('pagehide', () => {
  flagsmith.flushEvents();
});
`,
  },
];

export function healthyConfig(): ConfigEvidence {
  return {
    source: 'file',
    environment: { name: 'Staging', selfHosted: false },
    experiment: {
      id: 42,
      name: 'Checkout button',
      status: 'running',
      featureId: 7,
      featureName: 'checkout_button',
      metricIds: [3],
      startedAt: '2026-11-20T10:00:00Z',
      endedAt: null,
      rollout: { enabled: true, rolloutPercentage: 100 },
    },
    flag: {
      id: 7,
      name: 'checkout_button',
      type: 'MULTIVARIATE',
      variants: [{ id: 11, value: 'green', key: 'green', weight: 50 }],
    },
    metrics: [{ id: 3, name: 'Purchases', event: 'purchase', aggregation: 'occurrence', direction: 'up' }],
    warehouses: [{ id: 1, type: 'flagsmith', status: 'connected', totalEventsReceived: 1200, lastEventAt: '2026-11-27T09:00:00Z' }],
    results: {
      asOf: '2026-11-27T09:00:00Z',
      isFinal: false,
      srmPValue: 0.4,
      metrics: [
        {
          metricId: 3,
          aggregation: 'occurrence',
          variants: [
            { variant: 'control', identities: 310, conversions: 31, chanceToWin: null },
            { variant: 'green', identities: 298, conversions: 45, chanceToWin: 0.97, lift: 0.5, ciLow: 0.1, ciHigh: 0.9 },
          ],
        },
      ],
    },
  };
}

export function healthyEvidence(files: SourceFile[] = HEALTHY_APP): Evidence {
  return {
    schemaVersion: 1,
    collectedAt: '2026-11-27T10:00:00Z',
    target: { flag: 'checkout_button', experimentId: 42 },
    config: healthyConfig(),
    code: scanFiles(files),
  };
}

/** Replace one file of the healthy app. */
export function withFile(path: string, content: string, base: SourceFile[] = HEALTHY_APP): SourceFile[] {
  const others = base.filter((f) => f.path !== path);
  return [...others, { path, content }];
}

export function appWith(flagsTs: string): Evidence {
  return healthyEvidence(withFile('src/flags.ts', flagsTs));
}
