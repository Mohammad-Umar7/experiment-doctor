# enableEvents missing (enableAnalytics instead)

The SDK is initialised with `enableAnalytics: true`, which is flag usage analytics, not experiment events. Without `enableEvents: true`, getExperimentFlag is a plain read and trackEvent does nothing.

Expected diagnosis: **ED-009 (REPAIR_REQUIRED)**

```sh
npx experiment-doctor check --evidence examples/broken-apps/09-events-disabled/evidence.json
```
