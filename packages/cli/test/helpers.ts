import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Io, RunResult } from '../src/io';

export const ENV_KEY = 'aB3dE5fG7hJ9kL1mN3pQ5r';

export interface FakeIo extends Io {
  out: () => string;
  err: () => string;
  calls: { args: string[]; input?: string }[];
  fetches: { url: string; init?: RequestInit }[];
}

export interface FakeOptions {
  cwd: string;
  /** Responses keyed by the joined argv, e.g. "api api/v1/environments/KEY/". */
  flagsmith?: Record<string, unknown> | null;
  answers?: string[];
  fetch?: (url: string, init?: RequestInit) => Response | Promise<Response>;
  env?: Record<string, string>;
}

export function fakeIo(opts: FakeOptions): FakeIo {
  let stdout = '';
  let stderr = '';
  const answers = [...(opts.answers ?? [])];
  const calls: FakeIo['calls'] = [];
  const fetches: FakeIo['fetches'] = [];
  let clock = Date.parse('2026-11-27T10:00:00Z');
  return {
    cwd: opts.cwd,
    env: { NO_COLOR: '1', ...(opts.env ?? {}) },
    stdout: { write: (s: string) => (stdout += s), isTTY: false },
    stderr: { write: (s: string) => (stderr += s), isTTY: false },
    prompt: async (q: string) => {
      stdout += q;
      return answers.shift() ?? '';
    },
    fetch: (async (url: string, init?: RequestInit) => {
      fetches.push({ url: String(url), init });
      clock += 120;
      if (!opts.fetch) throw new Error('network disabled in tests');
      return opts.fetch(String(url), init);
    }) as typeof fetch,
    async runFlagsmith(args: string[], input?: string): Promise<RunResult> {
      calls.push({ args, input });
      if (opts.flagsmith === null || opts.flagsmith === undefined) return { code: 127, stdout: '', stderr: '', notFound: true };
      const key = args.join(' ');
      if (!(key in opts.flagsmith)) return { code: 1, stdout: '', stderr: `GET ${key} returned 404 Not Found` };
      const v = opts.flagsmith[key];
      if (v && typeof v === 'object' && '__result' in (v as object)) return (v as { __result: RunResult }).__result;
      return { code: 0, stdout: typeof v === 'string' ? v : JSON.stringify(v), stderr: '' };
    },
    now: () => new Date(clock),
    randomHex: () => 'c0ffee42',
    sleep: async (ms: number) => {
      clock += ms;
    },
    out: () => stdout,
    err: () => stderr,
    calls,
    fetches,
  };
}

export function tempDir(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'ed-cli-'));
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

export const APP_FILES: Record<string, string> = {
  'package.json': JSON.stringify({ name: 'shop', dependencies: { '@flagsmith/flagsmith': '^12.6.0' } }, null, 2),
  'flagsmith.json': JSON.stringify({ project: 12, environment: ENV_KEY }),
  'src/flags.ts': `import flagsmith from '@flagsmith/flagsmith';

export async function startFlags(user: { id: string }) {
  await flagsmith.init({
    environmentID: '${ENV_KEY}',
    enableEvents: true,
  });
  await flagsmith.identify(user.id);
  return flagsmith.getExperimentFlag('checkout_button');
}

export function trackPurchase() {
  flagsmith.trackEvent('Purchase');
}

window.addEventListener('pagehide', () => {
  flagsmith.flushEvents();
});
`,
};

const base = `api/v1/environments/${ENV_KEY}`;

export function flagsmithState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    '--version': 'flagsmith version 2.0.0',
    [`api ${base}/`]: { id: 1, name: 'Staging', api_key: ENV_KEY },
    [`api ${base}/warehouse-connections/`]: [{ id: 1, warehouse_type: 'flagsmith', status: 'connected', status_detail: null, config: null, total_events_received: 120, last_event_received_at: '2026-11-27T09:00:00Z' }],
    [`api ${base}/experiments/`]: {
      count: 1,
      results: [{ id: 42, name: 'Checkout button', status: 'running', feature: { id: 7, name: 'checkout_button' }, created_at: '2026-11-19T00:00:00Z' }],
    },
    [`api ${base}/experiments/42/`]: {
      id: 42,
      name: 'Checkout button',
      status: 'running',
      feature: { id: 7, name: 'checkout_button', type: 'MULTIVARIATE', multivariate_options: [{ id: 11, type: 'unicode', string_value: 'green', default_percentage_allocation: 50, key: 'green' }] },
      metrics: [{ id: 5, metric: 3, metric_name: 'Purchases', aggregation: 'occurrence', direction: 'up', expected_direction: 'increase' }],
      started_at: '2026-11-20T10:00:00Z',
      ended_at: null,
      rollout_decision: null,
      experiment_rollout: { enabled: true, rollout_percentage: 100 },
    },
    [`api ${base}/experiment-metrics/`]: { results: [{ id: 3, name: 'Purchases', aggregation: 'occurrence', direction: 'up', definition: { version: 1, event: 'purchase' } }] },
    [`api ${base}/experiments/42/results/`]: {
      results: {
        as_of: '2026-11-27T09:00:00Z',
        is_final: false,
        payload: {
          srm_p_value: 0.5,
          metrics: [{ metric_id: 3, variants: { control: { n: 300, sum: 30 }, green: { n: 290, sum: 41 } }, inference: { control: null, green: { lift: 0.4, ci_low: 0.05, ci_high: 0.8, chance_to_win: 0.97 } } }],
        },
      },
    },
    ...overrides,
  };
}
