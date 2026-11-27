# Self-hosted API, Cloud events URL

Flags come from a self-hosted Flagsmith (`http://localhost:8000`) that stores events in its own database, but the SDK has no `eventsApiUrl`, so every event goes to Flagsmith Cloud and is dropped.

Expected diagnosis: **ED-006 (REPAIR_REQUIRED)**

```sh
npx experiment-doctor check --evidence examples/broken-apps/06-wrong-events-endpoint/evidence.json
```
