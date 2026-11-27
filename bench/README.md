# Bench

Two questions, measured separately:

1. **Accuracy**: does the Doctor name the right root cause? `accuracy.mjs` runs the built CLI on every case in [`examples/broken-apps`](../examples/broken-apps) with `--evidence` (offline, no Flagsmith account needed) and checks the primary finding and the verdict against [`cases.json`](../examples/broken-apps/cases.json).
2. **Token efficiency**: how much does an agent read to get there? See [`TOKENS.md`](TOKENS.md) for the method and the table we fill in.

## Run

```sh
pnpm --filter @experiment-doctor/core build
pnpm --filter experiment-doctor build
node bench/accuracy.mjs                         # markdown table
node bench/accuracy.mjs --json                  # machine output
node bench/accuracy.mjs --out bench/results.json
```

Exit code 0 only when every case matches. The table also shows the run time and the size of the `check --json` output an agent reads (bytes / 4 as a rough token count).

## What a case is

Each case is a small app that breaks a Flagsmith experiment in exactly one way, plus an `evidence.json` holding the Flagsmith side (what the official CLI returns, mapped) and the code evidence from the scanner. A case passes when:

- the verdict matches (`REPAIR_REQUIRED`, `PENDING` or `HEALTHY`), and
- the primary finding is the expected rule (`ED-001` ... `ED-012`), or there is none for the healthy app.

Secondary findings are allowed (a broken pipeline often has symptoms downstream, such as ED-016 "no events reached the warehouse"), but they must rank below the root cause.

## Adding a case

1. Create `examples/broken-apps/<id>/` with the app files and a `README.md`.
2. Add the Flagsmith state and the expectation to `CASES` in `examples/broken-apps/build-evidence.mjs`.
3. `node examples/broken-apps/build-evidence.mjs` (rewrites `evidence.json` and `cases.json`).
4. `node bench/accuracy.mjs`.

## Limits

These cases are written by us, so 100% here shows the rules do what they say, not that they cover every real app. The scanner is static (regex and a small tokenizer): computed flag or event names, clients passed through dependency injection, or SDK calls in another repo are reported as "unknown", never as healthy.
