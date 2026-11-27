# Metric event name differs in case

The metric counts `purchase`, the React app sends `Purchase`. Event names are case-sensitive and unmatched events are ignored silently.

Expected diagnosis: **ED-004 (REPAIR_REQUIRED)**

```sh
npx experiment-doctor check --evidence examples/broken-apps/04-event-name-case/evidence.json
```
