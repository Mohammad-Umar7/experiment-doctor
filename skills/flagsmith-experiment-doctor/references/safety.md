# Safety model

## What changes what

| Command | Changes Flagsmith | Changes files | Needs |
| --- | --- | --- | --- |
| `check` | no (GET only) | `.experiment-doctor/last-report.json` | nothing |
| `verify` | no | nothing | a previous `check` or `fix` |
| `fix` (code patch) | no | the one patched line(s), only if unchanged since the diagnosis and inside the scanned folder (realpath, links included) | y/N, or `--yes` after the human said yes to the patch the last check showed (refused if a fresh diagnosis differs) |
| `fix` (flagsmith command) | yes | `.experiment-doctor/last-fix.json` | allowlisted environment **and** y/N |
| `canary` | yes (one identity, two events) | `.experiment-doctor/canary.json` | allowlisted environment **and** the typed environment name (or `--yes`) |

## The allowlist (fail-closed)

Flagsmith changes are refused unless the environment matches an entry by key or by name (case-insensitive):

```sh
experiment-doctor fix --allow-env Staging
```

or, in the app folder, `.experiment-doctor.json`:

```json
{ "allowMutations": ["Staging", "Development"] }
```

An unknown environment, an empty list, or an unreadable file means no. A name that looks like production is not trusted either way: it only adds a warning when it is allowlisted. `--yes` skips the y/N question, never the allowlist.

## What each kind of evidence proves

| Evidence | Proves | Does not prove |
| --- | --- | --- |
| `check` code rules | the app calls the SDK correctly (static) | that events arrive |
| `check` config rules | Flagsmith is set up (warehouse, keys, running experiment) | that this app's events arrive |
| `canary` ACCEPTED | Flagsmith ingestion takes events over HTTP for this environment | storage; the app's own SDK path |
| `canary --event-store` VERIFIED | a synthetic identity's exposure and conversion were stored, in order | the app's own SDK path |
| `verify --event-store --identity <real user>` PIPELINE_VERIFIED | a real user's exposure and conversion were stored, in order | statistical results |
| `EXPERIMENT_HEALTHY` | every required check passes and results have 50 identities / 5 conversions per variation | which variation wins (read the interval) |

Aggregate counters (warehouse `total_events_received`, last event time) are never used as proof: other traffic moves them. Identity-level evidence only counts for the same environment, experiment, flag and metric event as the current report, and only for events newer than the fix (or than the start of verify when nothing was fixed).

`--event-store` works with the self-hosted "Flagsmith database" warehouse: `docker:<compose project>[/<service>]` runs psql in that Postgres container, `psql:<url>` runs a local psql. Identity and key are passed as psql variables on stdin.
