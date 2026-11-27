# Broken apps

Small, realistic apps that each break a Flagsmith experiment in exactly one way, plus a healthy one. Nothing to install: the Doctor only reads the files.

Each folder has the app code, a `README.md` with the story, and an `evidence.json`: the Flagsmith side of the case (what `flagsmith api ...` returns, already mapped) plus the code evidence from the real scanner. That makes every diagnosis reproducible offline.

| Case | Breakage | Expected |
| --- | --- | --- |
| [01-missing-variant-key](01-missing-variant-key) | A variation created through the API without a key | ED-001 |
| [02-no-identify](02-no-identify) | getExperimentFlag before (without) identify | ED-002 |
| [03-identity-mismatch](03-identity-mismatch) | identify(user.id) for the flag, identify(user.email) at checkout | ED-003 |
| [04-event-name-case](04-event-name-case) | React app sends `Purchase`, the metric counts `purchase` | ED-004 |
| [05-unflushed-script](05-unflushed-script) | Node script exits before the 10 s event buffer is sent | ED-005 |
| [06-wrong-events-endpoint](06-wrong-events-endpoint) | Self-hosted API, events still go to Flagsmith Cloud | ED-006 |
| [07-no-warehouse](07-no-warehouse) | No warehouse connected, every event rejected | ED-007 |
| [08-experiment-draft](08-experiment-draft) | Experiment created but never started | ED-008 |
| [09-events-disabled](09-events-disabled) | `enableAnalytics` instead of `enableEvents` | ED-009 |
| [10-old-sdk](10-old-sdk) | `@flagsmith/flagsmith` pinned to 12.3.0 | ED-010 |
| [11-plain-flag-read](11-plain-flag-read) | `getValue()` instead of `getExperimentFlag()` | ED-011 |
| [12-collecting-data](12-collecting-data) | Healthy, but below 50 identities per variation | ED-012 (PENDING) |
| [healthy](healthy) | Everything right | HEALTHY |

## Try one

```sh
pnpm --filter @experiment-doctor/core build && pnpm --filter experiment-doctor build
node packages/cli/dist/cli.js check --evidence examples/broken-apps/04-event-name-case/evidence.json
```

Repair it and prove it (work on a copy so the example stays broken):

```sh
cp -r examples/broken-apps/04-event-name-case /tmp/case04
node packages/cli/dist/cli.js fix --evidence /tmp/case04/evidence.json      # shows the diff, asks y/N
node packages/cli/dist/cli.js verify --dir /tmp/case04                       # rescans the code: VERIFIED
```

## Rebuild the evidence

After changing a case's code, regenerate its code evidence (the Flagsmith side lives in `build-evidence.mjs`):

```sh
pnpm --filter @experiment-doctor/core build
node examples/broken-apps/build-evidence.mjs
```

The script also checks every case still produces its expected diagnosis and rewrites `cases.json`, the manifest used by `bench/` and the website.
