<div align="center">

<img src="apps/web/src/app/icon.svg" width="56" height="56" alt="" />

# Experiment Doctor

**Your experiment is flatlining. Find out why.**

A debugger for broken Flagsmith A/B tests, a CI gate that stops them from breaking,<br/>
and a game that is itself a live Flagsmith experiment.

[Live site](https://experimentdoctor.vercel.app) · [Play Human vs Doctor](https://experimentdoctor.vercel.app/play) · [Rescue Center](https://experimentdoctor.vercel.app/rescue) · [Doctor in your browser](https://experimentdoctor.vercel.app/report) · [CI Gate blocking a real PR](https://github.com/Mohammad-Umar7/experiment-doctor/pull/1)

</div>

---

## For judges: the evidence, per track

| Track | Look at this |
| --- | --- |
| **T1 Test Something Real** | The live experiment and its results: [Rescue Center](https://experimentdoctor.vercel.app/rescue) (Flagsmith inference, reconciliation with our server, timeline). Design and stopping rule: [The A/B test](#the-ab-test-track-1). Play it: [/play](https://experimentdoctor.vercel.app/play). |
| **T2 AI Agents and Feature Flags** | The CI Gate failing a real PR: [#1](https://github.com/Mohammad-Umar7/experiment-doctor/pull/1), and passing a harmless one: [#2](https://github.com/Mohammad-Umar7/experiment-doctor/pull/2). The CLI's approval gates and fail-closed allowlist: [docs/cli.md](docs/cli.md). The Doctor finding three real bugs in a self-hosted experiment, one of them a mistake in our own seed script: [selfhost/](selfhost). |
| **T3 Build on Open Source Flagsmith** | One-command self-hosted lab with Experimentation and per-identity verification from Flagsmith's own Postgres event store: [selfhost/](selfhost) and [Self-hosted rescue lab](#self-hosted-rescue-lab). |
| **T4 Flagsmith Agent Skills** | The skill: [skills/flagsmith-experiment-doctor](skills/flagsmith-experiment-doctor). Benchmark against plain Claude Code, losses included: [bench/BENCHMARK.md](bench/BENCHMARK.md). |

## The problem

Flagsmith Experimentation fails **silently**. The SDKs skip events instead of throwing, so a single wrong detail leaves an experiment at zero conversions with no error anywhere:

- the conversion is sent as `Purchase` while the metric counts `purchase`,
- the flag is read before `identify()`, so no exposure is recorded,
- the purchase is tracked under `user.email` while the exposure used `user.id`,
- the page redirects before the 10 second event buffer is flushed,
- `enableEvents: true` is missing, a variant has no key, no warehouse is connected...

During this hackathon thousands of developers are wiring up Experimentation (beta) for the first time, and Flagsmith's own tracker gained five experimentation issues on 26 November alone. Experiment Doctor finds where the signal dies, proposes one fix, applies it only after a human says yes, and then proves the fix worked.

## What's in the box

| Part | What it does | Track |
| --- | --- | --- |
| **`experiment-doctor` CLI** (`packages/cli`) | `check` reads your experiment through the official **Flagsmith CLI v2** (`flagsmith api ... --json`) and scans your code; `fix` shows one diff and asks y/N; `canary` sends an opt-in probe; `verify` re-checks and reports patch, pipeline and experiment health separately. Read-only by default, mutations only for allowlisted environments. | T2 |
| **Diagnosis engine** (`packages/core`) | Pure TypeScript: evidence model, a JS/TS scanner that follows imports and SDK bindings, 12 rules (`ED-001` to `ED-012`), a curated registry of known Flagsmith Experimentation bugs, report rendering. Runs in Node, in CI and in the browser. | T2, T4 |
| **Agent Skill** (`skills/flagsmith-experiment-doctor`) | Takes any coding agent through the whole job: diagnose, explain one root cause, propose the patch, get approval, apply, verify. Token-efficient `--json` output. | T4 |
| **CI Gate** (`action.yml`, `packages/action`) | GitHub Action that diffs the experiment wiring between the base and the PR, annotates the exact line and fails the check only for regressions the PR introduces (make it a required check to block merges). No secrets. | T2 |
| **Self-hosted rescue lab** (`selfhost/`) | Self-hosted Flagsmith with Experimentation on and events stored in its own Postgres, seeded with a broken experiment, real SDK traffic, and **per-identity pipeline verification**. | T3 |
| **Human vs Doctor** (`apps/web`) | A public game: fix a broken experiment in 3 minutes and race the Doctor. The hint you get is decided by a **live Flagsmith experiment**. | T1 |
| **Rescue Center** (`/rescue`) | Live results of that experiment: our server counts, Flagsmith's Bayesian inference, reconciliation between the two, and the Doctor checking our own experiment. | T1 |

## How we use Flagsmith

- **Experimentation, for real.** `doctor_hint_style` is a multivariate flag with a keyed variant, `verified_repair` is an occurrence metric, and a 50/50 experiment runs on Flagsmith Cloud. The site initialises the JS SDK with `enableEvents: true`, identifies every player on load, records the exposure with `getExperimentFlag` exactly when a counted run starts (practice runs never expose), sends `trackEvent("verified_repair")` only after the **server** verified the repair, and flushes on `pagehide`. We checked our own wiring with the Doctor.
- **Results API.** The Rescue Center shows Flagsmith's own chance to win, lift, 95% credible interval and sample ratio check, read from `/experiments/{id}/results/`.
- **Flagsmith CLI v2.** The Doctor collects config evidence through `flagsmith api`, `flagsmith feature get --json` and `--jq` so agents only read what they need. We also created this project's flag, metric and experiments with the CLI.
- **Self-hosted Flagsmith.** The lab runs the official images with `EXPERIMENTATION_ENABLED`, the *Flagsmith database* warehouse and the CLI's static credentials for `localhost:8000`.
- **Management API.** The lab seed creates the organisation, project, environment, warehouse connection, feature, metric and experiment.

## The A/B test (Track 1)

| | |
| --- | --- |
| Hypothesis | Players who get **one prioritized repair** as their hint restore a broken experiment within 180 seconds more often than players who get the **full diagnostic report**. |
| Flag | `doctor_hint_style`: control `full_report`, variant `one_fix` (keyed), 50/50 |
| Exposure | `getExperimentFlag("doctor_hint_style")` when a counted run starts |
| Metric | `verified_repair` (occurrence), sent only after a server-verified repair inside 180 s |
| Unit | one anonymous player id; only each player's first counted run feeds the analysis |
| Fairness | same button, position, latency and animation; only the presentation of the same evidence differs |
| Integrity | server-stamped clock (HMAC-signed sessions), the server never executes player code, reconciliation of server counts against Flagsmith's |
| Stopping rule | fixed: the submission deadline. We report whatever Flagsmith says, including "inconclusive" |

Results: see the [Rescue Center](https://experimentdoctor.vercel.app/rescue). This section is updated with the final numbers before submission.

## Quick start

### Run the Doctor on your own experiment

```bash
# in the repo that has the broken experiment, logged in with `flagsmith login` (Node 20+)
npx -y --package=https://experimentdoctor.vercel.app/doctor.tgz experiment-doctor check
npx -y --package=https://experimentdoctor.vercel.app/doctor.tgz experiment-doctor fix      # one diff, asks y/N
npx -y --package=https://experimentdoctor.vercel.app/doctor.tgz experiment-doctor verify   # patch, pipeline, experiment
```

`doctor.tgz` redirects to the [v0.1.0 release](https://github.com/Mohammad-Umar7/experiment-doctor/releases/tag/v0.1.0) tarball: the engine is bundled, no runtime dependencies. Full reference: [docs/cli.md](docs/cli.md).

Or skip installing anything: paste your code into the [browser Doctor](https://experimentdoctor.vercel.app/report). It runs the same engine locally in the page.

### Add the CI Gate

```yaml
# .github/workflows/experiment-doctor.yml
on: pull_request
jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with: { fetch-depth: 0 }
      - uses: Mohammad-Umar7/experiment-doctor@v0.1.0
```

Describe your experiment in `.experiment-doctor.json`:

```json
{ "flag": "checkout_button", "variants": ["one_click"], "metrics": ["purchase"], "paths": ["src"] }
```

### Self-hosted rescue lab

```bash
docker compose -p doctor-lab -f selfhost/docker-compose.yml up -d
node selfhost/seed.mjs                 # admin, warehouse, flag, metric, running experiment
node selfhost/lab.mjs broken           # real SDK traffic from the shipped bug
node selfhost/verify-events.mjs <id>   # FAILED: conversion stored as "Purchase"
# apply the Doctor's patch, then:
node selfhost/lab.mjs probe            # prints a fresh identity
node selfhost/verify-events.mjs <id>   # PIPELINE_VERIFIED
```

### Run the website locally

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local   # everything is optional
pnpm --filter web dev
```

Without Flagsmith or Supabase configured the game falls back to a local 50/50 split and an in-memory store.

## Architecture

```
            ┌────────────── packages/core (pure TS) ──────────────┐
            │ evidence → scanner → 12 rules → known bugs → report │
            └──────┬───────────────┬──────────────┬───────────────┘
                   │               │              │
        packages/cli          packages/action   apps/web (/report)
   flagsmith CLI v2 + code    CI Gate on PRs    same engine in the browser
                   │
        skills/flagsmith-experiment-doctor (any coding agent)

 apps/web  ── Flagsmith JS SDK ──▶ Flagsmith Cloud experiment (doctor_hint_style)
    │                                         │ results API
    └── route handlers ──▶ Supabase (RLS-locked, RPC only) ──▶ Rescue Center
```

## Benchmark: Doctor vs plain Claude Code

Same model (Claude Sonnet 5.5), same prompts, graded mechanically. Full method, every run, and the losses: [bench/BENCHMARK.md](bench/BENCHMARK.md).

| Suite | Doctor | Plain Claude Code |
| --- | --- | --- |
| Six game cases (one bug each) | **6/6 fixed**, 216 s, $1.29 | 3/6 fixed, 272 s, $1.16 |
| Self-hosted lab (3 bugs, code + config) | **3/3 found**, 85 s, $0.33 | 1/3, 329 s, $0.85 |
| Easy case, answer in the evidence | fixed and verified, 44.6 s, $0.22 | **fixed, 21.0 s, $0.16** |
| Healthy app | no change, correct | no change, correct, **cheaper** |

The Doctor is not faster on trivial cases. It wins where Flagsmith-specific knowledge matters: `trackEvent` only buffers, `enableEvents` gates everything, `getValue` records no exposure, a variation without a key drops its exposures.

## Honest limits

- The game verifies repairs **statically**: it parses the player's code and replays the SDK call order. It never runs the code. Live pipeline proof comes from the CLI and the self-hosted lab.
- On Flagsmith Cloud the Doctor cannot read individual events, so a probe there ends at *accepted* or *pending*, never *verified*. Per-identity verification needs an event store we can read, like the self-hosted lab's.
- Zero conversions is not automatically a bug. Without evidence of a defect the Doctor says *pending* or *unverifiable*.
- Upstream bug matches say "may be consistent with", never "not your fault".

## Repository

```
apps/web/          Next.js 16 site: landing, game, leaderboard, Rescue Center, browser Doctor
packages/core/     diagnosis engine (pure TypeScript)
packages/cli/      experiment-doctor CLI
packages/action/   CI Gate (bundled to dist/ for GitHub Actions)
skills/            Agent Skill
examples/          broken apps, one per failure, plus a healthy one
bench/             accuracy and token benchmark
selfhost/          self-hosted rescue lab
supabase/          game storage schema
demo/              the storefront the CI Gate protects
```

## Team FirstCommit

Mohammad Umar · Fuad Ahamed · Bilal · Mohammed Aamir Koilywala

Built for **Toggle Wars**, the Flagsmith Experimentation Hackathon by WeMakeDevs. MIT licensed.
