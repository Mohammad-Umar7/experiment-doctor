#!/usr/bin/env node
/**
 * Rebuilds evidence.json for every example case and the cases.json manifest.
 *
 * The Flagsmith side of each case is described below (what `flagsmith api ...`
 * would return, already mapped to evidence). The code side is produced by
 * scanning the case's files with the real scanner, so the two never drift.
 *
 *   pnpm --filter @experiment-doctor/core build
 *   node examples/broken-apps/build-evidence.mjs
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { diagnose, scanFiles } from '../../packages/core/dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const COLLECTED_AT = '2026-11-27T10:00:00.000Z';

const base = () => ({
  source: 'file',
  environment: { name: 'Staging', selfHosted: false },
  experiment: {
    id: 42,
    name: 'Green checkout button',
    status: 'running',
    featureId: 7,
    featureName: 'checkout_button',
    metricIds: [3],
    startedAt: '2026-11-24T09:00:00Z',
    endedAt: null,
    rolloutDecision: null,
    rollout: { enabled: true, rolloutPercentage: 100 },
  },
  flag: { id: 7, name: 'checkout_button', type: 'MULTIVARIATE', variants: [{ id: 11, value: 'green', key: 'green', weight: 50 }] },
  metrics: [{ id: 3, name: 'Purchases', event: 'purchase', aggregation: 'occurrence', direction: 'up' }],
  warehouses: [{ id: 1, type: 'flagsmith', status: 'connected', statusDetail: null, totalEventsReceived: 4210, lastEventAt: '2026-11-27T09:58:00Z' }],
  results: results([312, 33], [298, 47], 0.97, 0.41),
});

function results(control, green, chance, srm) {
  return {
    asOf: '2026-11-27T09:30:00Z',
    isFinal: false,
    lastErrorAt: null,
    srmPValue: srm,
    metrics: [
      {
        metricId: 3,
        aggregation: 'occurrence',
        variants: [
          { variant: 'control', identities: control[0], conversions: control[1], chanceToWin: null },
          { variant: 'green', identities: green[0], conversions: green[1], chanceToWin: chance },
        ],
      },
    ],
  };
}

const noEvents = (c) => {
  c.warehouses[0].totalEventsReceived = 0;
  c.warehouses[0].lastEventAt = null;
  c.results = null;
};

/** id, title, expected primary finding, expected verdict, Flagsmith state. */
export const CASES = [
  ['01-missing-variant-key', 'Variation without a key', 'ED-001', 'REPAIR_REQUIRED', (c) => {
    c.flag.variants[0].key = null;
    c.results = results([221, 25], [0, 0], null, null);
  }],
  ['02-no-identify', 'Experiment flag read before identify', 'ED-002', 'REPAIR_REQUIRED', (c) => {
    c.warehouses[0].totalEventsReceived = 0;
    c.results = null;
  }],
  ['03-identity-mismatch', 'Exposure and conversion identity mismatch', 'ED-003', 'REPAIR_REQUIRED', (c) => {
    c.results = results([160, 0], [151, 0], null, 0.6);
  }],
  ['04-event-name-case', 'Metric event name differs in case', 'ED-004', 'REPAIR_REQUIRED', (c) => {
    c.results = results([171, 0], [166, 0], null, 0.7);
  }],
  ['05-unflushed-script', 'Script exits before events are flushed', 'ED-005', 'REPAIR_REQUIRED', noEvents],
  ['06-wrong-events-endpoint', 'Self-hosted API, Cloud events URL', 'ED-006', 'REPAIR_REQUIRED', (c) => {
    c.environment = { name: 'Development', selfHosted: true, apiUrl: 'http://localhost:8000' };
    c.warehouses = [{ id: 1, type: 'postgres', status: 'connected', statusDetail: null, flagsmithDatabase: true, totalEventsReceived: 0, lastEventAt: null }];
    c.results = null;
  }],
  ['07-no-warehouse', 'No warehouse connected', 'ED-007', 'REPAIR_REQUIRED', (c) => {
    c.warehouses = [];
    c.results = null;
  }],
  ['08-experiment-draft', 'Experiment created but never started', 'ED-008', 'REPAIR_REQUIRED', (c) => {
    c.experiment.status = 'created';
    c.experiment.startedAt = null;
    c.experiment.rollout = null;
    delete c.results;
  }],
  ['09-events-disabled', 'enableEvents missing (enableAnalytics instead)', 'ED-009', 'REPAIR_REQUIRED', noEvents],
  ['10-old-sdk', 'SDK too old for experiments', 'ED-010', 'REPAIR_REQUIRED', noEvents],
  ['11-plain-flag-read', 'getValue instead of getExperimentFlag', 'ED-011', 'REPAIR_REQUIRED', (c) => {
    c.warehouses[0].totalEventsReceived = 57;
    c.results = results([0, 0], [0, 0], null, null);
  }],
  ['12-collecting-data', 'Healthy, still collecting data', 'ED-012', 'PENDING', (c) => {
    c.results = results([23, 2], [19, 4], 0.71, null);
  }],
  ['healthy', 'Healthy experiment', null, 'HEALTHY', () => {}],
];

const CODE = /\.(?:[mc]?[jt]sx?)$|package\.json$/;

function readCase(dir) {
  const files = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (name === 'node_modules' || name.startsWith('.')) continue;
      if (statSync(full).isDirectory()) walk(full);
      else if (CODE.test(name)) files.push({ path: relative(dir, full).split(sep).join('/'), content: readFileSync(full, 'utf8') });
    }
  };
  walk(dir);
  return files;
}

const manifest = [];
let mismatches = 0;
for (const [id, title, expected, verdict, mutate] of CASES) {
  const dir = join(here, id);
  const config = base();
  mutate(config);
  const evidence = {
    schemaVersion: 1,
    collectedAt: COLLECTED_AT,
    target: { flag: 'checkout_button', experimentId: 42 },
    config,
    code: scanFiles(readCase(dir)),
  };
  writeFileSync(join(dir, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  const report = diagnose(evidence);
  const got = report.primaryFinding?.kind === 'defect' || report.verdict === 'PENDING' ? report.primaryFinding?.id ?? null : null;
  const ok = got === expected && report.verdict === verdict;
  if (!ok) mismatches++;
  manifest.push({ id, title, expected, verdict, readme: `${id}/README.md`, evidence: `${id}/evidence.json` });
  console.log(`${ok ? 'ok ' : 'BAD'} ${id.padEnd(26)} ${String(got).padEnd(7)} ${report.verdict}`);
}
writeFileSync(join(here, 'cases.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`\n${manifest.length} cases written${mismatches ? `, ${mismatches} do not match their expectation` : ''}.`);
process.exitCode = mismatches ? 1 : 0;
