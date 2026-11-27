# No warehouse connected

The code is correct, but the environment has no warehouse connection, so the ingestion service rejects every event.

Expected diagnosis: **ED-007 (REPAIR_REQUIRED)**

```sh
npx experiment-doctor check --evidence examples/broken-apps/07-no-warehouse/evidence.json
```
