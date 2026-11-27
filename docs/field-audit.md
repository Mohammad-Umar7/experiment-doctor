# Field audit: the Doctor on real code it has never seen

Our example apps were written by us, so passing them proves little about false positives. To test the scanner on code we did not write, we ran it on **8 public GitHub repositories that call `getExperimentFlag`**, found with GitHub code search on 27 November 2026.

How we ran it:
- **Read-only.** We cloned each repository into a scratch folder and ran `experiment-doctor check --dir . --json` there. Nothing was changed or reported to the owners.
- **No code copied.** Every regression test we added uses a small synthetic fixture that reproduces the pattern.
- **Code only.** We have no access to these projects' Flagsmith, so the config rules (variant keys, metric events, warehouse, results) were skipped. Every run therefore ends `UNVERIFIABLE`, which is the honest verdict when half the evidence is missing.
- **Anonymized.** The repositories are numbered 1 to 8 instead of named.

The question was narrow: **does the Doctor claim a repair is required when the code is fine?**

## Before: 4 of 8 were false alarms

On the first run, 4 of the 8 repositories came back `REPAIR_REQUIRED`. We checked each one by hand, and all 4 were false positives. They came from four patterns our own examples never had:

| # | Pattern in the wild | What the Doctor got wrong | Fix |
| --- | --- | --- | --- |
| 1 | Unit tests that call `flagsmith.init()` without `enableEvents` | Counted test code as app code, so ED-009 fired | Test and fixture files (`*.test.*`, `*.spec.*`, `__tests__/`, `test/`, `e2e/`, `fixtures/`, …) are skipped and listed in the notes |
| 2 | A minified copy of the Flagsmith SDK served from `public/` | Read the SDK's own source as the app's calls | Minified, vendored and bundled files are skipped (`*.min.js`, very long lines, `public/`, `vendor/`, `dist/`, `build/`, files that look like the SDK itself) |
| 3 | A monorepo with two apps that identify users differently | Paired one app's exposure with the other app's conversion, so ED-003 reported an identity mismatch | Calls are grouped by the nearest `package.json`, and pairing never crosses apps |
| 4 | Options built by a helper: `new Flagsmith({ ...options })` or `new Flagsmith(config())` | Treated "not visible" as "missing", so ED-009 fired | A spread or a non-literal argument makes `enableEvents` *unknown*: no finding, a note instead. Same for `eventsApiUrl` in ED-006 |

## Round 2: 1 of 8

After those fixes, one repository still came back `REPAIR_REQUIRED` with ED-009. It has several entry points, each with its own `init`. A plain page without `enableEvents` was blamed, even though the init next to the experiment calls sets `enableEvents: true`. That is a fifth pattern:

| # | Pattern in the wild | What the Doctor got wrong | Fix |
| --- | --- | --- | --- |
| 5 | Several entry points, each with its own `init` | Blamed an init that never serves the experiment | ED-009 only blames an init that serves the experiment calls: one in the same file, the only init in the app, one in a module those files import, or every init when none sets `enableEvents` |

## After: 0 of 8

Third run, same 8 repositories, CLI rebuilt from `main`:

| Repo | Files scanned | Skipped (tests, bundles) | SDK calls seen | Verdict | Findings |
| --- | ---: | ---: | --- | --- | --- |
| 1 | 46 | 1 | 1 init, 2 experiment reads, 1 event | `UNVERIFIABLE` | none |
| 2 | 38 | 34 | 3 inits, 2 experiment reads, 2 events | `UNVERIFIABLE` | none |
| 3 | 369 | 5 | none (see below) | `UNVERIFIABLE` | none |
| 4 | 107 | 20 | 3 inits, 1 experiment read, 1 event | `UNVERIFIABLE` | none |
| 5 | 47 | 15 | 2 inits, 1 experiment read, 2 events | `UNVERIFIABLE` | 1 info note (ED-005) |
| 6 | 92 | 4 | 1 init, 3 experiment reads | `UNVERIFIABLE` | none |
| 7 | 75 | 13 | 2 inits, 5 experiment reads, 5 events | `UNVERIFIABLE` | none |
| 8 | 10 | 4 | 1 init, 1 experiment read | `UNVERIFIABLE` | none |

**No repository is flagged `REPAIR_REQUIRED`, and no code check fails.** Between 5 and 7 code checks passed in each repository with SDK calls, and the config checks were skipped.

Three of these deserve a closer look:

- **Repo 3 has no Flagsmith SDK at all.** It defines its own functions named `getExperimentFlag` and `trackEvent`. The Doctor did not mistake them for the SDK.
- **Repo 5 gets one advisory note,** at `info` severity with 0.5 confidence: a browser conversion with no `flushEvents()` can be lost if the page closes within one flush interval. That is true in general. It is not a defect, and the verdict does not change. The note used to say the SDK flushes "every 10 seconds". This repository sets its own `flushInterval`, so we changed the wording to "on a timer (every 10 seconds unless flushInterval is set)".
- **Repos 6 and 8 read experiment flags but send no `trackEvent` from this code.** The conversions may come from a backend or another service, so the Doctor says nothing without the experiment's metric to compare against. This is the "unverifiable, not broken" rule working as intended.

## What this does and does not show

- It shows **precision on code-level rules**: real code that the Doctor should leave alone no longer gets a repair-required verdict.
- It does **not** show recall. We do not know whether these experiments are actually healthy, because their Flagsmith side was out of reach. Recall is measured on the 13 example apps (`node bench/accuracy.mjs`, 13/13) and in the agent benchmark ([`bench/BENCHMARK.md`](../bench/BENCHMARK.md)).
- 8 repositories is a small sample, and most are recent hackathon-sized codebases. We will rerun the audit as more public code adopts Experimentation.

Each of the five patterns has a regression test in `packages/core/test/precision.test.ts`, so they cannot come back silently.
