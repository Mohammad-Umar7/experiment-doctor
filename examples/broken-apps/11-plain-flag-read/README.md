# getValue instead of getExperimentFlag

The button reads the flag with `getValue()`. It gets the right variation but records no exposure, so nobody is counted as enrolled.

Expected diagnosis: **ED-011 (REPAIR_REQUIRED)**

```sh
npx experiment-doctor check --evidence examples/broken-apps/11-plain-flag-read/evidence.json
```
