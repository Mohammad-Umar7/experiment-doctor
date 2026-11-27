# Benchmark: Claude Code with the Doctor vs plain Claude Code

Does the `flagsmith-experiment-doctor` skill and CLI make a coding agent better at fixing broken Flagsmith experiments? We measured it, and we report the runs it lost.

**Short version:** on easy cases where the evidence spells out the answer, plain Claude Code is faster and cheaper. On the cases that need Flagsmith-specific knowledge, and on a realistic self-hosted setup with bugs in both code and config, the Doctor gets right what the plain agent gets wrong. On the realistic multi-bug setup it was also faster and cheaper.

## Setup

- **Harness:** Claude Code, headless (`claude -p --output-format json`), a fresh session per run, Claude Sonnet 5.5 for both arms. Numbers below come from the harness's own usage report.
- **Arm "Doctor":** the skill copied into `.claude/skills/`, the CLI installed from the v0.1.0 tarball. Tools: Read, Edit, Glob, Grep, `npx experiment-doctor`, `node` (plus `flagsmith` in the lab run).
- **Arm "plain":** no skill, no CLI. Tools: Read, Edit, Glob, Grep, WebFetch, WebSearch, `node` (plus `flagsmith` in the lab run). It may read Flagsmith's docs.
- **Same prompt for both arms** within each suite, quoted below. Each run starts from a git-tracked copy so the diff is exact.
- **Grading is mechanical.** For the six game cases, the edited `checkout.js` goes through the game's repair verifier (`apps/web/src/lib/game/verify.ts`, 22 tests), which statically replays the Flagsmith SDK call order. For the other suites we read the diff against the known bugs.
- **Tokens** are everything the model processed: input + cache writes + cache reads + output. Most of it is Claude Code's own cached context re-read every turn, so turns drive tokens. Cost is the harness's `total_cost_usd`.

Raw per-run summaries (final answer, turns, time, cost, token breakdown, with local paths removed): [`bench/runs/`](runs).

## Suite 1: the six Human vs Doctor cases

Each folder holds the exact game case as `src/checkout.js`, a stub `src/shop.js`, a `package.json` with `@flagsmith/flagsmith` 12.6.0, and the Flagsmith side of the experiment as `evidence.json`.

> *Our Flagsmith A/B test on the checkout_button flag shows no useful data. The Flagsmith side (flag, metric, experiment) is saved in evidence.json in this folder, so you do not need to call Flagsmith. Find the root cause in the code and fix it. You have my approval to apply the code fix. Reply with the root cause in one sentence.*

| Case | Bug | Doctor | Plain | Doctor time / turns / cost | Plain time / turns / cost |
| --- | --- | --- | --- | --- | --- |
| 001 | ED-004 `Purchase` vs metric `purchase` | ✅ fixed | ✅ fixed | 37.5 s / 10 / $0.199 | **15.3 s / 7 / $0.154** |
| 002 | ED-002 flag read before `identify()` | ✅ fixed | ✅ fixed | 25.3 s / 6 / $0.174 | **22.5 s / 4 / $0.153** |
| 003 | ED-005 redirect before the buffer flushes | ✅ fixed | ❌ wrote `await flagsmith.trackEvent(...)`, but `trackEvent` returns `void` and only buffers | 31.8 s / 10 / $0.213 | 22.0 s / 4 / $0.154 |
| 004 | ED-003 exposure as `user.id`, purchase as `user.email` | ✅ fixed | ✅ fixed | 25.1 s / 5 / $0.162 | 23.6 s / 7 / $0.164 |
| 005 | ED-009 `enableEvents: true` missing | ✅ fixed | ❌ added a flush; events stay disabled | 46.5 s / 16 / $0.262 | 154.5 s / 10 / $0.358 |
| 006 | ED-011 `getValue()` instead of `getExperimentFlag()` | ✅ fixed | ❌ found nothing, changed nothing | 50.2 s / 16 / $0.278 | 34.2 s / 7 / $0.180 |
| **Total** | | **6 / 6** | **3 / 6** | 216 s / $1.29 | 272 s / $1.16 |

Each of the Doctor's six times is the "Doctor's record" a player races in the game ([`apps/web/src/lib/doctor-record.ts`](../apps/web/src/lib/doctor-record.ts), generated from these runs).

**Caveat.** To keep the runs offline, every case reused the same `evidence.json` (taken from `examples/broken-apps/04-event-name-case`). Its counts show exposures arriving and zero conversions. That fits cases 001, 003 and 004, but in cases 002, 005 and 006 the real symptom would be zero exposures. The mismatch makes those three harder to reason about from the numbers. It may have hurt the plain agent more, since the Doctor relies on code rules, not on the counts. The plain agent's three misses are 003, 005 and 006, so read 005 and 006 with this in mind. 003's miss does not depend on the counts: `await` on a `void` call is wrong whatever the data says.

## Suite 2: a healthy app (false positives)

`examples/broken-apps/healthy`, nothing broken. Prompt as above, ending with *"fix it if anything is broken"*.

| | Doctor | Plain |
| --- | --- | --- |
| Verdict | ✅ nothing broken, no change | ✅ nothing broken, no change |
| Time / turns / cost | 23.1 s / 9 / $0.170 | **17.6 s / 7 / $0.154** |
| Tokens | 293,329 | **175,426** |

Neither arm invented a fix. The plain agent was cheaper.

## Suite 3: an easy case with the answer in the evidence

`examples/broken-apps/04-event-name-case` (a React app sending `Purchase`), with an `evidence.json` that names the metric's event directly.

| | Doctor | Plain |
| --- | --- | --- |
| Result | ✅ same 1-line diff, plus `PATCH_VERIFIED` | ✅ same 1-line diff, not verified |
| Time / turns / cost | 44.6 s / 10 / $0.221 | **21.0 s / 8 / $0.162** |
| Tokens | 492,711 | **286,108** |

**The Doctor loses this one.** When the evidence already spells out the answer, its read, fix and verify workflow is overhead.

## Suite 4: a realistic self-hosted experiment

The self-hosted rescue lab (`selfhost/`): real Flagsmith with Experimentation, reached through the real Flagsmith CLI v2, and an app with **three real bugs across code and config**:
- ED-001: the variation was created through the API without a key. That bug was in our own seed script, not planted.
- ED-004: `Purchase` vs `purchase`.
- ED-006: the app sends events to Flagsmith Cloud while the experiment is self-hosted.

> *Our A/B test on the checkout_button flag runs on our self-hosted Flagsmith, and it is useless: the one_click arm looks empty in the results and conversions stay at zero. The Flagsmith CLI is already configured for this instance (flagsmith.json in this folder and environment variables). Find every root cause, in the code and in the Flagsmith configuration. Fix code problems directly, you have my approval. Do NOT change anything in Flagsmith itself: for config problems, give the exact command you would run. Finish with the root causes, one line each.*

Run twice per arm. Run 2 ran both arms at the same time, so its wall times are slower.

| | Doctor run 1 | Doctor run 2 | Plain run 1 | Plain run 2 |
| --- | --- | --- | --- | --- |
| ED-001 variation without key | ✅ found + exact command, noted the flag is locked | ✅ found, left untouched | ❌ "no Flagsmith configuration problem" | ❌ missed; proposed re-weighting `one_click` on the running, locked experiment instead |
| ED-004 `Purchase` vs `purchase` | ✅ fixed | ✅ fixed | ❌ said the metric matches `Purchase` (read the metric's display name, not its event) | ❌ same mistake |
| ED-006 events sent to Cloud | ✅ fixed (`api` + `eventsApiUrl`) | ✅ fixed (`api` + `eventsApiUrl`) | ✅ fixed | ⚠️ half: added `api` only, events still go to Cloud |
| Unrequested changes | none | none | several refactors | an extra flush |
| **Outcome** | **identified 3/3**, fixed both code bugs, proposed the config fix without touching the running experiment | **same** | identified 1/3, fixed 1 | identified 0/3 fully (1 half-fixed) |
| Time / turns / cost | 85.1 s / 25 / $0.334 | 182.5 s / 25 / $0.359 | 329.4 s / 57 / $0.852 | 251.8 s / 31 / $0.643 |
| Tokens | 895,338 | 809,916 | 2,662,531 | 2,201,196 |

## What we take from it

- **Don't claim the Doctor is always faster or cheaper.** On trivial or pre-digested cases it isn't (suites 2 and 3, and cases 001 and 002).
- **Its value is SDK knowledge the model doesn't reliably have:**
  - `trackEvent` buffers and returns nothing,
  - `enableEvents` gates everything,
  - `getValue` records no exposure,
  - a variation without a key drops exposures,
  - a metric's name is not its event.

  The plain agent missed or misapplied every one of these.
- On the realistic multi-bug case the Doctor identified all three root causes in both runs, repaired both code defects and proposed the configuration fix without modifying the running experiment; plain Claude Code identified 1/3 and then 0/3, made the same metric-name mistake twice, and once proposed a harmful config change. The Doctor was also cheaper ($0.33 to $0.36 vs $0.64 to $0.85).

Small sample: one run per arm per case in suites 1 to 3, two in suite 4. Re-run with the commands below to check.

## Reproduce

```bash
# Doctor arm, in a copy of a case folder
npm i --no-save experiment-doctor-0.1.0.tgz && mkdir -p .claude/skills && cp -r <repo>/skills/flagsmith-experiment-doctor .claude/skills/
claude -p "<prompt above>" --output-format json --max-turns 30 \
  --allowedTools "Read" "Edit" "Glob" "Grep" "Bash(npx experiment-doctor:*)" "Bash(node:*)"

# plain arm
claude -p "<prompt above>" --output-format json --max-turns 30 \
  --allowedTools "Read" "Edit" "Glob" "Grep" "WebFetch" "WebSearch" "Bash(node:*)"
```

Accuracy of the CLI alone on all 13 example apps (no agent): `node bench/accuracy.mjs` (13/13, median `check --json` ≈ 400 tokens).
