# Script exits before events are flushed

A traffic simulator reads the experiment flag and tracks conversions for 200 users, then calls `process.exit(0)`. The SDK buffers events for 10 seconds, so nothing is ever sent.

Expected diagnosis: **ED-005 (REPAIR_REQUIRED)**

```sh
npx experiment-doctor check --evidence examples/broken-apps/05-unflushed-script/evidence.json
```
