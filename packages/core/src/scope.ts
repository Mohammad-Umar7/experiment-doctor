import type { CodeEvidence, SourceLocation } from './types';

/**
 * Monorepos: every folder with a package.json is its own app or package.
 * Identity, exposure and conversion calls are only ever paired inside one
 * app, so the diagnosis is scoped to a single app and never mixes two.
 */

/** The app folder a file belongs to: the nearest folder with a package.json ('' is the root). */
export function appOf(file: string, roots: string[]): string {
  let best = '';
  for (const r of roots) {
    if (r && (file === r || file.startsWith(`${r}/`)) && r.length > best.length) best = r;
  }
  return best;
}

export interface AppScope {
  code: CodeEvidence;
  /** The app that was diagnosed, or null when the code is a single app. */
  app: string | null;
  /** Other apps with Flagsmith code, left out of this diagnosis. */
  otherApps: string[];
  reason?: string;
}

type Located = { loc: SourceLocation };

export function scopeToApp(code: CodeEvidence, flagKey: string | null): AppScope {
  const roots = code.appRoots ?? [];
  if (roots.length <= 1) return { code, app: null, otherApps: [] };
  const of = (l: Located) => appOf(l.loc.file, roots);
  const items: Located[] = [...code.inits, ...code.identifies, ...code.experimentFlags, ...code.plainFlagReads, ...code.trackEvents, ...code.exposures, ...code.flushes];
  const weight = new Map<string, number>();
  for (const i of items) weight.set(of(i), (weight.get(of(i)) ?? 0) + 1);
  const active = [...weight.keys()].sort();
  if (active.length === 0) return { code, app: null, otherApps: [] };

  const pick = (apps: string[]) => [...apps].sort((a, b) => (weight.get(b) ?? 0) - (weight.get(a) ?? 0) || a.localeCompare(b))[0];
  const withFlag = flagKey ? active.filter((a) => code.experimentFlags.some((c) => c.flag === flagKey && of(c) === a) || code.exposures.some((e) => e.flag === flagKey && of(e) === a)) : [];
  const readingFlag = flagKey ? active.filter((a) => code.plainFlagReads.some((r) => r.flag === flagKey && of(r) === a)) : [];
  const withExperiment = active.filter((a) => code.experimentFlags.some((c) => of(c) === a));
  let app: string;
  let reason: string;
  if (withFlag.length) {
    app = pick(withFlag)!;
    reason = `it reads the experiment flag "${flagKey}"`;
  } else if (readingFlag.length) {
    app = pick(readingFlag)!;
    reason = `it reads the flag "${flagKey}"`;
  } else if (withExperiment.length) {
    app = pick(withExperiment)!;
    reason = 'it reads an experiment flag';
  } else {
    app = pick(active)!;
    reason = 'it has the most Flagsmith code';
  }

  const inApp = (l: Located) => of(l) === app;
  // A manifest counts for the app when it sits in the app folder or in a parent (a workspace root).
  const manifestCounts = (file: string) => {
    const dir = file.replace(/(^|\/)package\.json$/, '');
    return dir === app || dir === '' || app.startsWith(`${dir}/`);
  };
  const scoped: CodeEvidence = {
    ...code,
    files: code.files.filter((f) => appOf(f.file, roots) === app),
    packages: code.packages.filter((p) => manifestCounts(p.manifest.file)),
    inits: code.inits.filter(inApp),
    identifies: code.identifies.filter(inApp),
    experimentFlags: code.experimentFlags.filter(inApp),
    plainFlagReads: code.plainFlagReads.filter(inApp),
    trackEvents: code.trackEvents.filter(inApp),
    exposures: code.exposures.filter(inApp),
    flushes: code.flushes.filter(inApp),
    exits: code.exits.filter(inApp),
  };
  if (code.experimentUpdates) scoped.experimentUpdates = code.experimentUpdates.filter(inApp);
  return { code: scoped, app, otherApps: active.filter((a) => a !== app), reason };
}
