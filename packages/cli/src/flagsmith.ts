import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  listOf,
  mapEnvironment,
  mapExperiment,
  mapExperimentFeature,
  mapFeatureGet,
  mapMetrics,
  mapResults,
  mapWarehouses,
  pickExperiment,
  redactSecrets,
  type ConfigEvidence,
} from '@experiment-doctor/core';
import type { Io, RunResult } from './io';
import { looksLikeEnvKey } from './safety';

export const INSTALL_HINT = [
  'Install the Flagsmith CLI (v2):',
  '  macOS/Linux:  curl -fsSL https://get.flagsmith.com | sh   (or: brew install Flagsmith/tap/flagsmith)',
  '  Windows:      irm https://raw.githubusercontent.com/Flagsmith/flagsmith-cli/main/install.ps1 | iex',
  'then run: flagsmith login   (self-hosted: set FLAGSMITH_API_URL and FLAGSMITH_API_KEY)',
].join('\n');

export const LOGIN_HINT = 'Not logged in to Flagsmith. Run `flagsmith login` (Cloud), or set FLAGSMITH_API_KEY (and FLAGSMITH_API_URL when self-hosting).';

export interface FlagsmithJson {
  path: string;
  project?: number | string;
  environment?: string;
  apiUrl?: string;
}

/** Finds flagsmith.json in `dir` or a parent directory. */
export function findFlagsmithJson(dir: string): FlagsmithJson | null {
  let cur = dir;
  for (let i = 0; i < 20; i++) {
    const p = join(cur, 'flagsmith.json');
    if (existsSync(p)) {
      try {
        const j = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
        const out: FlagsmithJson = { path: p };
        if (typeof j.project === 'number' || typeof j.project === 'string') out.project = j.project;
        if (typeof j.environment === 'string') out.environment = j.environment;
        if (typeof j.apiUrl === 'string') out.apiUrl = j.apiUrl;
        return out;
      } catch {
        return { path: p };
      }
    }
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

export class FlagsmithError extends Error {
  constructor(
    message: string,
    readonly kind: 'not-installed' | 'not-logged-in' | 'http' | 'parse' | 'usage',
  ) {
    super(message);
  }
}

/** Thin, read-mostly wrapper over the official CLI. Never prints keys. */
export class FlagsmithCli {
  private secrets: string[] = [];
  constructor(private readonly io: Io) {}

  addSecret(s: string | undefined) {
    if (s) this.secrets.push(s);
  }

  clean(text: string): string {
    let out = redactSecrets(text);
    for (const s of this.secrets) out = out.split(s).join('<env-key>');
    return out.trim().split('\n').slice(0, 4).join(' ');
  }

  async run(args: string[], input?: string): Promise<RunResult> {
    const res = await this.io.runFlagsmith(args, input);
    if (res.notFound) throw new FlagsmithError('Flagsmith CLI not found.', 'not-installed');
    return res;
  }

  async version(): Promise<string> {
    const res = await this.run(['--version']);
    return (res.stdout || res.stderr).trim();
  }

  async json(args: string[], input?: string): Promise<unknown> {
    const res = await this.run(args, input);
    if (res.code !== 0) {
      const msg = this.clean(res.stderr || res.stdout);
      if (/flagsmith login|not logged in|unauthori[sz]ed|\b401\b|\b403\b|credential/i.test(msg)) throw new FlagsmithError(LOGIN_HINT, 'not-logged-in');
      throw new FlagsmithError(`flagsmith ${args[0]} ${args[0] === 'api' ? this.clean(args[1] ?? '') : ''} failed: ${msg || `exit ${res.code}`}`, 'http');
    }
    try {
      return JSON.parse(res.stdout);
    } catch {
      throw new FlagsmithError(`flagsmith ${args[0]} returned non-JSON output.`, 'parse');
    }
  }

  api(path: string, input?: string, method?: string): Promise<unknown> {
    const args = ['api', path];
    if (method) args.push('-X', method);
    if (input !== undefined) args.push('--input', '-');
    return this.json(args, input);
  }
}

export interface CollectOptions {
  dir: string;
  flag?: string;
  experimentId?: number;
  /** Environment key or name; defaults to flagsmith.json. */
  environment?: string;
}

export interface Collected {
  config: ConfigEvidence | null;
  /** The resolved environment key. Keep in memory only. */
  envKey?: string;
  problems: string[];
}

/**
 * Collects config evidence through the Flagsmith CLI. Read-only: only GETs.
 * Any failure degrades to unknown (`config: null` or missing fields) with a
 * human-readable problem, never a guess.
 */
export async function collectConfig(io: Io, opts: CollectOptions): Promise<Collected> {
  const cli = new FlagsmithCli(io);
  const problems: string[] = [];
  const fsJson = findFlagsmithJson(opts.dir);
  const envRef = opts.environment ?? io.env.FLAGSMITH_ENVIRONMENT ?? fsJson?.environment;

  try {
    const v = await cli.version();
    const major = /(\d+)\.\d+/.exec(v)?.[1];
    if (major && Number(major) < 2) problems.push(`Flagsmith CLI ${v} is older than v2; upgrade it.`);
  } catch (err) {
    if (err instanceof FlagsmithError && err.kind === 'not-installed') return { config: null, problems: [`Flagsmith CLI not found, so Flagsmith config was not checked.\n${INSTALL_HINT}`] };
    throw err;
  }
  if (!envRef) {
    return { config: null, problems: ['No Flagsmith environment selected: run `flagsmith init` in your app (writes flagsmith.json) or pass --environment <key>.'] };
  }

  const config: ConfigEvidence = { source: 'flagsmith-cli', errors: [] };
  let envKey = envRef;
  try {
    if (!looksLikeEnvKey(envRef)) {
      const env = (await cli.json(['environment', 'get', envRef, '--json'])) as { api_key?: string };
      if (!env.api_key) throw new FlagsmithError(`Environment "${envRef}" was not found.`, 'http');
      envKey = env.api_key;
    }
    cli.addSecret(envKey);
    const base = `api/v1/environments/${envKey}`;
    const apiUrl = io.env.FLAGSMITH_API_URL ?? fsJson?.apiUrl;
    const environment = mapEnvironment(await cli.api(`${base}/`), apiUrl, envKey);
    if (environment) config.environment = environment;

    const soft = async <T>(label: string, f: () => Promise<T>): Promise<T | undefined> => {
      try {
        return await f();
      } catch (err) {
        if (err instanceof FlagsmithError && err.kind === 'not-logged-in') throw err;
        config.errors!.push(`${label}: ${err instanceof Error ? cli.clean(err.message) : String(err)}`);
        return undefined;
      }
    };

    const warehouses = await soft('warehouse-connections', () => cli.api(`${base}/warehouse-connections/`));
    if (warehouses !== undefined) config.warehouses = mapWarehouses(warehouses);

    const list = await soft('experiments', () => cli.api(`${base}/experiments/`));
    if (list !== undefined) {
      const picked = pickExperiment(list, { experimentId: opts.experimentId, flag: opts.flag });
      if (!picked) {
        const targeted = !!opts.flag || opts.experimentId !== undefined;
        config.experiment = targeted || listOf(list).length === 0 ? null : undefined;
        if (config.experiment === undefined) problems.push('Only completed experiments found; pass --flag or --experiment to pick one.');
      } else {
        const id = picked.id as number;
        const detail = await soft('experiment detail', () => cli.api(`${base}/experiments/${id}/`));
        const exp = mapExperiment(detail ?? picked);
        if (exp) config.experiment = exp;
        const flag = mapExperimentFeature((detail as { feature?: unknown } | undefined)?.feature ?? picked.feature);
        if (flag) config.flag = flag;
        const metrics = await soft('experiment-metrics', () => cli.api(`${base}/experiment-metrics/`));
        if (metrics !== undefined && exp) config.metrics = mapMetrics(metrics, exp.metricIds);
        if (exp && exp.status !== 'created') {
          const results = await soft('results', () => cli.api(`${base}/experiments/${id}/results/`));
          if (results !== undefined) {
            const mapped = mapResults(results, config.metrics);
            if (mapped !== undefined) config.results = mapped;
          }
        }
      }
    }
    if (!config.flag && opts.flag) {
      const f = await soft('feature get', () => cli.json(['feature', 'get', opts.flag!, '--json']));
      const flag = mapFeatureGet(f);
      if (flag) config.flag = flag;
    }
  } catch (err) {
    if (err instanceof FlagsmithError) {
      problems.push(err.kind === 'not-logged-in' ? LOGIN_HINT : cli.clean(err.message));
      return { config: null, problems };
    }
    throw err;
  }
  if (!config.errors!.length) delete config.errors;
  else problems.push(...config.errors!.map((e) => `Could not read ${e}`));
  return { config, envKey, problems };
}
