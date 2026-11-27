# Exposure and conversion identity mismatch

The flag is read for `user.id`, but the checkout re-identifies the user by email "so receipts are linked". Conversions land on a different identity that was never exposed.

Expected diagnosis: **ED-003 (REPAIR_REQUIRED)**

```sh
npx experiment-doctor check --evidence examples/broken-apps/03-identity-mismatch/evidence.json
```
