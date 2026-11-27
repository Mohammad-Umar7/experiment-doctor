---
name: flagsmith-experiment-doctor
description: Diagnoses and repairs Flagsmith Experimentation A/B tests that show no exposures, no conversions or "collecting data" forever. Finds the root cause (variation without key, missing identify, identity mismatch, metric event name or case mismatch, unflushed events, wrong events URL, no warehouse, experiment not started, enableEvents missing, SDK too old, getValue instead of getExperimentFlag), proposes one patch or flagsmith CLI command, applies it only after the human approves, then verifies. Use when a user says their Flagsmith experiment is empty, broken, flatlining, not tracking, or asks why exposures or conversions do not show.
license: MIT
compatibility: Needs Node 20+ and npx. Flagsmith CLI v2 (flagsmith) for live config checks; without it the skill still checks the code.
metadata:
  author: FirstCommit (Toggle Wars 2026)
  version: "0.1.0"
allowed-tools: Bash(npx experiment-doctor check:*) Bash(npx experiment-doctor verify:*) Bash(flagsmith --version) Read
---

# Flagsmith Experiment Doctor

Do the whole job with the `experiment-doctor` CLI. Do not read the Flagsmith docs: the rules already encode them. Read only what each step below names.

## Workflow

1. **Diagnose (read-only).** From the app directory:
   `npx experiment-doctor check --json [--flag <key>] [--dir <app dir>]`
   (in this repo: `node packages/cli/dist/cli.js check --json`, or `scripts/run-doctor.mjs check --json`).
   Read `verdict`, `primary`, `notes`, `upstream`, `next`. Ignore `others` for now.
2. **Branch on `verdict`.**
   - `HEALTHY`: say so in one line and stop.
   - `PENDING`: no defect; explain the wait (each variation needs 50 identities, and 5 conversions for occurrence metrics). Change nothing. Stop.
   - `UNVERIFIABLE`: relay `notes` (for example `flagsmith login`, or `--dir`). Stop, or re-run once the human fixes it.
   - `REPAIR_REQUIRED`: continue.
3. **Explain** `primary` in one short paragraph: what is broken (`title`), where (`evidence[].location` file:line), why it loses data (`detail`, condensed). Mention `upstream` items as "possible Flagsmith bug #N" with their workaround; never patch around them.
4. **Show the fix.** Run `npx experiment-doctor fix --dry-run` with the same flags and show its diff (`fix.patch`) or the exact `flagsmith` command (`fix.command`, marked "changes Flagsmith"). If `fix.patch.placeholder` is true, point out the placeholder.
5. **Ask** the human to approve that one change. Wait for an explicit yes.
6. **Apply** only after yes: `npx experiment-doctor fix --yes` (same flags). Never edit around the CLI for config changes.
7. **Verify:** `npx experiment-doctor verify --json`. Report `status`:
   `VERIFIED` (fixed, check passes), `FAILED` (still there or a new problem: report it, do not loop), `PENDING` (cannot confirm yet, or waiting for data).
8. **Stop.** If verify names a next finding, offer to repeat steps 3 to 7 for it. One finding at a time.

## Safety rules

- Read-only by default. `check` and `verify` change nothing. `fix` and `canary` only after the human approves that exact action in this conversation.
- Never touch production. If the environment name looks like production, do not run `fix` for config or `canary`. Never add `--allow-production` unless the human asks for it by name.
- Never print, log, commit or paste API keys: no `flagsmith auth token`, no `cat flagsmith.env`, no `echo $FLAGSMITH_API_KEY`. Commands use `<env-key>`; the CLI fills it in.
- Never start, pause or complete an experiment, change a rollout, weights or overrides, without approval. Do not edit the rollout of a running experiment.
- `canary` sends a real exposure and conversion for a `doctor-canary-*` identity. Only on request, only in an environment the human names: `npx experiment-doctor canary --environment <name>`.
- Upstream bugs are not code defects: report them with the issue link and workaround, propose no patch.
- Do not use the Flagsmith MCP server for experiments (it cannot start experiments, and updates fail: issue #9136).

## When you need raw Flagsmith data

Use the official CLI with `--json --jq` so only the needed fields come back. Recipes: [references/flagsmith-cli.md](references/flagsmith-cli.md).

## References (load only when needed)

- [references/rules.md](references/rules.md): what each ED-xxx finding means and its usual fix.
- [references/json-output.md](references/json-output.md): the `check --json` and `verify --json` shapes.
- [references/known-bugs.md](references/known-bugs.md): Flagsmith issues the Doctor recognises.
- [scripts/run-doctor.mjs](scripts/run-doctor.mjs): runs the local or npx CLI with the same arguments.
- [scripts/snapshot.sh](scripts/snapshot.sh): one-screen experiment state from the Flagsmith CLI (no keys printed).
