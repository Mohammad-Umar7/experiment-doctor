import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { redactDeep, type Evidence, type Report } from '@experiment-doctor/core';

export const STATE_DIR = '.experiment-doctor';

export interface Invocation {
  flag?: string;
  experiment?: number;
  /** Directory scanned, relative to the state directory's parent. */
  dir?: string;
  evidence?: string;
  environment?: string;
}

export interface SavedReport {
  savedAt: string;
  invocation: Invocation;
  report: Report;
  evidence: Evidence;
}

export function statePath(root: string, file: string): string {
  return join(root, STATE_DIR, file);
}

export function saveState(root: string, file: string, value: unknown, secrets: string[] = []): string {
  const dir = join(root, STATE_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = join(dir, file);
  writeFileSync(path, `${JSON.stringify(redactDeep(value, secrets), null, 2)}\n`);
  return path;
}

export function loadState<T>(root: string, file: string): T | null {
  const path = statePath(root, file);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
}
