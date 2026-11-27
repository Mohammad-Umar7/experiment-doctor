# SDK too old for experiments

The app pins `@flagsmith/flagsmith` 12.3.0. Experiment exposures need 12.4.0 or newer.

Expected diagnosis: **ED-010 (REPAIR_REQUIRED)**

```sh
npx experiment-doctor check --evidence examples/broken-apps/10-old-sdk/evidence.json
```
