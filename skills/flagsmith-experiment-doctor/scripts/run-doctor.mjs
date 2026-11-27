#!/usr/bin/env node
/**
 * Runs experiment-doctor with the given arguments, using the first CLI found:
 *   1. $EXPERIMENT_DOCTOR_BIN (path to cli.js)
 *   2. the repo build next to this skill (packages/cli/dist/cli.js)
 *   3. ./node_modules/.bin/experiment-doctor
 *   4. a release tarball in the current folder (experiment-doctor-*.tgz), via npx
 *   5. the pinned GitHub release tarball (RELEASE_URL below), via npx
 *
 * It never asks npx for the bare name `experiment-doctor`: that name is not
 * published on the npm registry by this project, so whatever answers to it
 * there would be someone else's code.
 *
 *   node scripts/run-doctor.mjs check --json
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const here = dirname(fileURLToPath(import.meta.url));
const cwd = process.cwd();
const isWin = process.platform === 'win32';

function run(cmd, argv, shell = false) {
  const res = spawnSync(cmd, argv, { stdio: 'inherit', shell });
  if (res.error) return null;
  return res.status ?? 1;
}

const candidates = [process.env.EXPERIMENT_DOCTOR_BIN, resolve(here, '../../../packages/cli/dist/cli.js')].filter(Boolean);
for (const js of candidates) {
  if (existsSync(js)) process.exit(run(process.execPath, [js, ...args]) ?? 1);
}

const local = join(cwd, 'node_modules', '.bin', isWin ? 'experiment-doctor.cmd' : 'experiment-doctor');
if (existsSync(local)) process.exit(run(local, args, isWin) ?? 1);

const RELEASE_URL = 'https://github.com/Mohammad-Umar7/experiment-doctor/releases/download/v0.2.0/experiment-doctor-0.2.0.tgz';
const tarball = readdirSync(cwd).filter((f) => /^experiment-doctor-\d+\.\d+\.\d+\.tgz$/.test(f)).sort().pop();
const npx = isWin ? 'npx.cmd' : 'npx';
const target = tarball ? `./${tarball}` : RELEASE_URL;
// --package=<tarball or URL> plus the bin name: "npx <tarball>" alone installs and exits silently.
const code = run(npx, ['--yes', `--package=${target}`, 'experiment-doctor', ...args], isWin);
if (code === null) {
  console.error(`experiment-doctor could not be started. Build it (pnpm --filter experiment-doctor build) or download ${RELEASE_URL} into this folder.`);
  process.exit(127);
}
process.exit(code);
