import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import { diagnose, redactDeep, renderHtmlReport, scanFiles, toAgentSummary, type Evidence, type Report } from '@experiment-doctor/core';
import { experimentId, parse, TARGET_OPTIONS, UsageError } from '../args';
import { makePalette } from '../color';
import { readSourceFiles, toPosix } from '../files';
import { collectConfig } from '../flagsmith';
import type { Io } from '../io';
import { renderReport } from '../render';
import { looksLikeEnvKey } from '../safety';
import { saveState, STATE_DIR, type Invocation, type SavedReport } from '../state';

export const CHECK_HELP = `experiment-doctor check: passive, read-only diagnosis

Usage: experiment-doctor check [options]

  --flag <key>            flag under test (default: the experiment's flag)
  --experiment <id>       experiment id (default: the running experiment of --flag)
  --dir <path>            app code to scan (default: .)
  --environment <key|name> Flagsmith environment (default: flagsmith.json)
  --evidence <file.json>  use saved evidence instead of calling Flagsmith
                          (add --dir to rescan the code part)
  --save-evidence <file>  write the collected evidence (keys redacted)
  --report <file>         write a report: .html (self-contained) or .json (full Report)
  --json                  compact JSON for agents on stdout
  --no-save               do not write .experiment-doctor/last-report.json

Reads Flagsmith through the official CLI (flagsmith api ... GET only) and scans
your code. Nothing is changed. Exit code 1 when a repair is required.`;

export interface CheckOptions {
  flag?: string;
  experiment?: number;
  /** Directory to scan; also where .experiment-doctor/ lives. */
  dir?: string;
  evidence?: string;
  environment?: string;
  save?: boolean;
}

export interface CheckRun {
  report: Report;
  evidence: Evidence;
  /** Environment key, in memory only. */
  envKey?: string;
  notes: string[];
  root: string;
  savedTo?: string;
}

export function loadEvidence(path: string): Evidence {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new UsageError(`Cannot read evidence file ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const ev = raw as Partial<Evidence>;
  if (!ev || typeof ev !== 'object' || !('config' in ev || 'code' in ev)) throw new UsageError(`${path} is not an Experiment Doctor evidence file.`);
  return { schemaVersion: 1, config: ev.config ?? null, code: ev.code ?? null, ...ev } as Evidence;
}

/** Where the app and its .experiment-doctor/ live: --dir, else next to --evidence, else the cwd. */
export function stateRoot(io: Io, opts: Pick<CheckOptions, 'dir' | 'evidence'>): string {
  if (opts.dir) return resolve(io.cwd, opts.dir);
  if (opts.evidence) return dirname(resolve(io.cwd, opts.evidence));
  return io.cwd;
}

/** Collects evidence, diagnoses, and saves the report. Shared by check, fix and verify. */
export async function performCheck(io: Io, opts: CheckOptions): Promise<CheckRun> {
  const notes: string[] = [];
  let evidence: Evidence;
  let envKey: string | undefined;
  const evidencePath = opts.evidence ? resolve(io.cwd, opts.evidence) : undefined;
  // With --evidence and no --dir, the app lives next to the evidence file.
  const root = stateRoot(io, opts);

  if (evidencePath) {
    evidence = loadEvidence(evidencePath);
    if (opts.dir) {
      evidence.code = scanFiles(readSourceFiles(root));
      notes.push(`Loaded Flagsmith evidence from ${displayPath(io.cwd, evidencePath)}; code rescanned from ${displayPath(io.cwd, root) || '.'}.`);
    }
  } else {
    const collected = await collectConfig(io, { dir: root, flag: opts.flag, experimentId: opts.experiment, environment: opts.environment });
    notes.push(...collected.problems);
    envKey = collected.envKey;
    evidence = {
      schemaVersion: 1,
      collectedAt: io.now().toISOString(),
      config: collected.config,
      code: scanFiles(readSourceFiles(root)),
    };
  }
  if (opts.flag || opts.experiment !== undefined) {
    evidence.target = { ...(evidence.target ?? {}) };
    if (opts.flag) evidence.target.flag = opts.flag;
    if (opts.experiment !== undefined) evidence.target.experimentId = opts.experiment;
  }
  if (evidence.code && evidence.code.scannedFiles === 0) notes.push(`No JS/TS files found in ${displayPath(io.cwd, root) || '.'}; code checks were skipped.`);

  const report = diagnose(evidence, { now: io.now().toISOString() });
  const run: CheckRun = { report, evidence, notes, root };
  if (envKey) run.envKey = envKey;

  if (opts.save !== false) {
    const invocation: Invocation = { dir: '.' };
    if (opts.flag) invocation.flag = opts.flag;
    if (opts.experiment !== undefined) invocation.experiment = opts.experiment;
    if (evidencePath) invocation.evidence = toPosix(relative(root, evidencePath));
    if (opts.environment && !looksLikeEnvKey(opts.environment)) invocation.environment = opts.environment;
    const saved: SavedReport = { savedAt: io.now().toISOString(), invocation, report, evidence };
    try {
      saveState(root, 'last-report.json', saved, envKey ? [envKey] : []);
      run.savedTo = displayPath(io.cwd, resolve(root, STATE_DIR, 'last-report.json'));
    } catch {
      notes.push(`Could not write ${STATE_DIR}/last-report.json (verify needs it).`);
    }
  }
  return run;
}

/** Relative to cwd when inside it, absolute otherwise. */
export function displayPath(cwd: string, path: string): string {
  const rel = toPosix(relative(cwd, path));
  return rel && !rel.startsWith('..') ? rel : toPosix(path);
}

export function writeReportFile(io: Io, file: string, report: Report, secrets: string[]): string {
  const path = resolve(io.cwd, file);
  mkdirSync(dirname(path), { recursive: true });
  const ext = extname(path).toLowerCase();
  if (ext === '.html' || ext === '.htm') writeFileSync(path, renderHtmlReport(report, { knownSecrets: secrets }));
  else if (ext === '.json') writeFileSync(path, `${JSON.stringify(redactDeep(report, secrets), null, 2)}\n`);
  else throw new UsageError('--report must end in .html or .json');
  return path;
}

export async function checkCommand(io: Io, argv: string[]): Promise<number> {
  const { values } = parse(argv, {
    ...TARGET_OPTIONS,
    report: { type: 'string' },
    'save-evidence': { type: 'string' },
    'no-save': { type: 'boolean', default: false },
  });
  if (values.help) {
    io.stdout.write(`${CHECK_HELP}\n`);
    return 0;
  }
  const run = await performCheck(io, {
    flag: values.flag,
    experiment: experimentId(values.experiment),
    dir: values.dir,
    evidence: values.evidence,
    environment: values.environment,
    save: !values['no-save'],
  });
  const secrets = run.envKey ? [run.envKey] : [];
  if (values['save-evidence']) {
    const p = resolve(io.cwd, values['save-evidence']);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, `${JSON.stringify(redactDeep(run.evidence, secrets), null, 2)}\n`);
    run.notes.push(`Evidence written to ${displayPath(io.cwd, p)}.`);
  }
  let reportPath: string | undefined;
  if (values.report) {
    reportPath = writeReportFile(io, values.report, run.report, secrets);
    run.notes.push(`Report written to ${displayPath(io.cwd, reportPath)}.`);
  }

  if (values.json) {
    const out = { ...toAgentSummary(run.report), notes: run.notes, ...(run.savedTo ? { saved: run.savedTo } : {}) };
    io.stdout.write(`${JSON.stringify(redactDeep(out, secrets))}\n`);
  } else {
    const c = makePalette(io.env, io.stdout.isTTY);
    io.stdout.write(renderReport(redactDeep(run.report, secrets), c, { notes: run.notes, savedTo: run.savedTo }));
  }
  return run.report.verdict === 'REPAIR_REQUIRED' ? 1 : 0;
}
