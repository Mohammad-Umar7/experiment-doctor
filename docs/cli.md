# experiment-doctor CLI

Diagnoses a Flagsmith Experimentation setup, proposes one fix, applies it only after approval, and verifies it. Read-only unless you say yes.

## Install

```sh
pnpm --filter @experiment-doctor/core build
pnpm --filter experiment-doctor build          # dist/cli.js, core bundled in
node packages/cli/dist/cli.js --help

pnpm --filter experiment-doctor pack           # experiment-doctor-0.1.0.tgz, no runtime dependencies
npx ./experiment-doctor-0.1.0.tgz check        # from any folder
```

Live config checks use the official [Flagsmith CLI v2](https://github.com/Flagsmith/flagsmith-cli) (`flagsmith login`, then `flagsmith init` in your app to write `flagsmith.json`). Without it, `check` still runs the code rules and marks the Flagsmith side `unknown`.

## Commands

### check (read-only)

```sh
experiment-doctor check [--flag <key>] [--experiment <id>] [--dir .] [--environment <key|name>]
                        [--json] [--report report.html|report.json]
                        [--evidence evidence.json] [--save-evidence file.json] [--no-save]
```

- Reads Flagsmith with GET calls only (`flagsmith api ...`): environment, warehouse connections, experiments, experiment detail, metrics, results.
- Scans JS/TS/JSX/TSX under `--dir` (skips `node_modules`, reads installed SDK versions).
- `--evidence` replays saved evidence offline; add `--dir` to rescan the code part. Without `--dir`, the app is assumed to sit next to the evidence file.
- Writes `.experiment-doctor/last-report.json` (keys redacted) for `verify`.
- Exit code 1 when the verdict is `REPAIR_REQUIRED`, 2 for usage errors.

### fix

```sh
experiment-doctor fix [--finding ED-xxx] [--dry-run] [--yes] [--allow-env <key|name>]... (+ check options)
```

- Code fixes: shows a diff, asks y/N, writes only if the lines are unchanged since the diagnosis and the file resolves (realpath, links included) inside the scanned folder.
- Flagsmith fixes: shows the exact `flagsmith` command with `<env-key>`, refuses unless the environment is allowlisted, then asks y/N. `--yes` never skips the allowlist. Exit code 3 when refused.

### verify

```sh
experiment-doctor verify [--dir .] [--json] [--event-store <spec> --identity <real user id> [--event <name>]]
```

Compares a fresh check with `.experiment-doctor/last-report.json` (verify never overwrites it) and reports three separate statuses:

| Part | Values |
| --- | --- |
| `patch` | `PATCH_VERIFIED`, `PATCH_FAILED`, `PATCH_UNVERIFIED`, `NO_PATCH_TARGET` |
| `pipeline` | `PIPELINE_VERIFIED` (identity-level evidence only), `PIPELINE_FAILED`, `PIPELINE_UNVERIFIED` |
| `experiment` | `EXPERIMENT_HEALTHY`, `EXPERIMENT_PENDING`, `EXPERIMENT_REPAIR_REQUIRED`, `EXPERIMENT_UNVERIFIABLE` |

Pipeline evidence comes from the last canary or, with `--event-store` and `--identity`, from one real user's stored events (the app's own SDK path). Exit code 1 on `PATCH_FAILED` or `PIPELINE_FAILED`.

### canary

```sh
experiment-doctor canary --environment <name|key> --allow-env <name|key> [--flag <key>] [--event <name>]
                         [--event-store docker:<compose project>[/<service>] | psql:<url>] [--wait 20]
                         [--dry-run] [--yes] [--json]
```

Sends one `$flag_exposure` and one conversion for `doctor-canary-<random>` to the same HTTP endpoints the SDKs use, after you type the environment name. It exercises Flagsmith ingestion, not your app's SDK instrumentation. Results:

| Status | Means |
| --- | --- |
| `VERIFIED` | `--event-store` holds this identity's exposure, then its conversion |
| `ACCEPTED` | ingestion answered 2xx and accepted both events; storage not proven (Flagsmith's API has no identity-level read) |
| `FAILED` | rejected, unreachable, flag or experiment not served, variation without key, or stored wrongly |
| `PENDING` | nothing conclusive (outside the rollout, or not in the store yet) |

## Allowlist

Flagsmith changes (`fix` commands, `canary`) are fail-closed. Allow an environment by key or name with `--allow-env` (repeatable) or in `.experiment-doctor.json` next to your app:

```json
{ "allowMutations": ["Staging"] }
```

A production-looking name only adds a warning; the allowlist alone decides.

## Event store (self-hosted, Flagsmith database warehouse)

`--event-store docker:doctor-lab` finds the running `postgres` container of compose project `doctor-lab` and runs psql in it; `psql:<url>` uses a local psql. The query reads `experimentation_sdkexperimentationevent` for one identity and environment, with both values passed as psql variables on stdin. Aggregate counters are never used as proof.

## Files

| Path | Written by | Content |
| --- | --- | --- |
| `.experiment-doctor/last-report.json` | check, fix | `{ savedAt, invocation, report, evidence }`, keys redacted |
| `.experiment-doctor/last-fix.json` | fix | what was applied |
| `.experiment-doctor/canary.json` | canary | the last canary result |
| `.experiment-doctor.json` | you | `{ "allowMutations": [...] }` |

## JSON shapes

`check --json`, `verify --json` and `canary --json`: see [skills/flagsmith-experiment-doctor/references/json-output.md](../skills/flagsmith-experiment-doctor/references/json-output.md). The full `Report` (from `--report x.json` or `diagnose()`) is typed in [packages/core/src/types.ts](../packages/core/src/types.ts).

## Core API (`@experiment-doctor/core`, pure TypeScript, browser-safe)

```ts
import { scanFiles, diagnose, toAgentSummary, renderHtmlReport, compareReports, evaluateIdentityEvents } from '@experiment-doctor/core';

const code = scanFiles([{ path: 'src/app.ts', content }]);
const report = diagnose({ schemaVersion: 1, config: null, code });
```

| Export | Does |
| --- | --- |
| `scanFiles(files)` | code evidence from `{ path, content }[]` |
| `diagnose(evidence)` | runs every rule, returns a `Report` |
| `toAgentSummary(report)` | the compact `check --json` shape |
| `compareReports(before, after, probe?)` | the `verify` result |
| `renderHtmlReport(report)` | a self-contained dark HTML page |
| `evaluateIdentityEvents(identity, rows, { flag, event })` | identity-level pipeline verdict |
| `KNOWN_BUGS`, `matchKnownBugs` | the curated Flagsmith issue registry |
| `map*` | raw Flagsmith API JSON to evidence |
