# Experiment created but never started

Everything is wired, but the experiment is still in the `created` state, so no identity is enrolled and no exposure is recorded.

Expected diagnosis: **ED-008 (REPAIR_REQUIRED)**

```sh
npx experiment-doctor check --evidence examples/broken-apps/08-experiment-draft/evidence.json
```
