import { parseArgs, type ParseArgsConfig } from 'node:util';

export class UsageError extends Error {}

type Options = NonNullable<ParseArgsConfig['options']>;

/** Options shared by check, fix and verify. */
export const TARGET_OPTIONS = {
  flag: { type: 'string' },
  experiment: { type: 'string' },
  dir: { type: 'string' },
  evidence: { type: 'string' },
  environment: { type: 'string' },
  json: { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false },
} as const satisfies Options;

export function parse<T extends Options>(argv: string[], options: T) {
  try {
    return parseArgs({ args: argv, options, allowPositionals: false, strict: true });
  } catch (err) {
    throw new UsageError(err instanceof Error ? err.message.replace(/^TypeError \[[A-Z_]+\]: /, '') : String(err));
  }
}

export function experimentId(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new UsageError(`--experiment must be a positive integer id, got "${raw}"`);
  return n;
}
