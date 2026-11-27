#!/usr/bin/env node
/**
 * Runs the built CLI on every example case with --evidence (offline) and checks
 * that the primary finding and verdict match the expectation in cases.json.
 *
 *   pnpm --filter @experiment-doctor/core build && pnpm --filter experiment-doctor build
 *   node bench/accuracy.mjs [--json] [--out bench/results.json]
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'packages', 'cli', 'dist', 'cli.js');
const examples = join(root, 'examples', 'broken-apps');
const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const outFile = outIdx >= 0 ? args[outIdx + 1] : null;

if (!existsSync(cli)) {
  console.error('Build the CLI first: pnpm --filter @experiment-doctor/core build && pnpm --filter experiment-doctor build');
  process.exit(2);
}

const cases = JSON.parse(readFileSync(join(examples, 'cases.json'), 'utf8'));
const rows = [];
for (const c of cases) {
  const t0 = performance.now();
  const res = spawnSync(process.execPath, [cli, 'check', '--evidence', join(examples, c.evidence), '--json', '--no-save'], {
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', FLAGSMITH_CLI_BIN: 'flagsmith-not-used-in-bench' },
  });
  const ms = Math.round(performance.now() - t0);
  let out = null;
  try {
    out = JSON.parse(res.stdout);
  } catch {
    // reported below
  }
  const got = out ? (out.verdict === 'HEALTHY' ? null : out.primary?.id ?? null) : 'ERROR';
  const verdict = out?.verdict ?? 'ERROR';
  rows.push({
    case: c.id,
    expected: c.expected,
    got,
    expectedVerdict: c.verdict,
    verdict,
    ok: got === c.expected && verdict === c.verdict,
    ms,
    jsonBytes: Buffer.byteLength(res.stdout ?? ''),
  });
}

const correct = rows.filter((r) => r.ok).length;
const summary = {
  cases: rows.length,
  correct,
  accuracy: rows.length ? correct / rows.length : 0,
  medianMs: [...rows].map((r) => r.ms).sort((a, b) => a - b)[Math.floor(rows.length / 2)] ?? 0,
  medianJsonTokens: Math.round(([...rows].map((r) => r.jsonBytes).sort((a, b) => a - b)[Math.floor(rows.length / 2)] ?? 0) / 4),
};

if (args.includes('--json')) {
  console.log(JSON.stringify({ summary, rows }, null, 2));
} else {
  console.log('| Case | Expected | Got | Verdict | OK | ms | JSON ≈tokens |');
  console.log('| --- | --- | --- | --- | --- | ---: | ---: |');
  for (const r of rows) {
    console.log(`| ${r.case} | ${r.expected ?? '-'} | ${r.got ?? '-'} | ${r.verdict} | ${r.ok ? 'yes' : '**no**'} | ${r.ms} | ${Math.round(r.jsonBytes / 4)} |`);
  }
  console.log(`\nAccuracy: ${correct}/${rows.length} (${Math.round(summary.accuracy * 100)}%). Median run ${summary.medianMs} ms. Median --json output ≈ ${summary.medianJsonTokens} tokens (bytes / 4).`);
}
if (outFile) writeFileSync(join(process.cwd(), outFile), `${JSON.stringify({ generatedAt: new Date().toISOString(), summary, rows }, null, 2)}\n`);
process.exitCode = correct === rows.length ? 0 : 1;
