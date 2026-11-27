# Experiment flag read before identify

The app reads the experiment flag right after `init()` and never calls `identify()`. Anonymous reads record no exposure, so the Exposures panel stays empty.

Expected diagnosis: **ED-002 (REPAIR_REQUIRED)**

```sh
npx experiment-doctor check --evidence examples/broken-apps/02-no-identify/evidence.json
```
