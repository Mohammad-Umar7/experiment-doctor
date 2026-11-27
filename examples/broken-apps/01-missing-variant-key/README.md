# Variation without a key

The `green` variation was created through the API without a `key`. Its exposures are dropped, so the green arm stays empty while control fills up. The code is fine.

Expected diagnosis: **ED-001 (REPAIR_REQUIRED)**

```sh
npx experiment-doctor check --evidence examples/broken-apps/01-missing-variant-key/evidence.json
```
