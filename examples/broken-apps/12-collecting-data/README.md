# Healthy, still collecting data

The pipeline is wired correctly but only 23 and 19 users have been exposed. Flagsmith shows "collecting data" until each variation has 50 identities and 5 conversions. Not broken: pending.

Expected diagnosis: **ED-012 (PENDING)**

```sh
npx experiment-doctor check --evidence examples/broken-apps/12-collecting-data/evidence.json
```
