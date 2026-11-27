---
name: flagsmith-experiment-doctor
description: Diagnoses and repairs Flagsmith Experimentation A/B tests that show no exposures, no conversions or "collecting data" forever. Finds the root cause (variation without key, missing identify, identity mismatch, metric event name or case mismatch, unflushed events, wrong events URL, no warehouse, experiment not started, enableEvents missing, SDK too old, getValue instead of getExperimentFlag), proposes one patch or flagsmith CLI command, applies it only after the human approves, then verifies. Use when a user says their Flagsmith experiment is empty, broken, flatlining, not tracking, or asks why exposures or conversions do not show.
license: MIT
compatibility: Needs Node 20+ and npx. Flagsmith CLI v2 (flagsmith) for live config checks; without it the skill still checks the code.
metadata:
  author: FirstCommit (Toggle Wars 2026)
  version: "0.3.0"
allowed-tools: Bash(npx experiment-doctor check:*) Bash(npx experiment-doctor verify:*) Bash(flagsmith --version) Read
---

# Flagsmith Experiment Doctor

Do the whole job with the `experiment-doctor` CLI. Do not read the Flagsmith docs: the rules already encode them. Read only what each step below names. `scripts/run-doctor.mjs <command>` finds the CLI (local build, installed, a release tarball, or npx).

## Workflow

1. **Diagnose (read-only)** from the app directory:
   `npx experiment-doctor check --json [--flag <key>] [--dir <app dir>]`
   Read `verdict`, `primary`, `notes`, `upstream`, `next`. Ignore `others` for now.
2. **Branch on `verdict`.**
   - `HEALTHY`: say so in one line and stop.
   - `PENDING`: no defect; explain the wait (each variation needs 50 identities, and 5 conversions for occurrence metrics). Zero conversions alone is not a bug. Change nothing. Stop.
   - `UNVERIFIABLE`: relay `notes` (for example `flagsmith login`, or `--dir`). Stop, or re-run once the human fixes it.
   - `REPAIR_REQUIRED`: continue.
3. **Explain** `primary` in one short paragraph: what is broken (`title`), where (`evidence[].location` file:line), why it loses data (`detail`, condensed). For each `upstream` item say: "symptoms may be consistent with Flagsmith issue #N (state, checked date); confirm the affected operation and error before applying the workaround". Never patch around it, never blame or clear the user's code because of it.
4. **Show the fix** straight from the check output, no extra command: `primary.fix.patch` as a diff (`file:line`, `- before`, `+ after`) or `primary.fix.command` (the exact `flagsmith` command; `writes: true` means it changes Flagsmith). If `patch.placeholder` is true, point out the placeholder.
5. **Ask** the human to approve that one change. Wait for an explicit yes.
6. **Apply** only after yes: `npx experiment-doctor fix --yes` (same flags). It applies exactly the patch or command from that check and refuses, writing nothing, if a fresh diagnosis differs (lines moved or edited, another finding first) or the target lines changed. Flagsmith changes also need the environment on the allowlist (see Safety). On any refusal, relay the reason and stop; re-run step 1 if the human wants to continue.
7. **Verify:** `npx experiment-doctor verify --json`. Report the three answers separately, never as one "it works":
   - `patch.status`: `PATCH_VERIFIED` (the rule now passes), `PATCH_FAILED` (still there or a new finding: report it, do not loop), `PATCH_UNVERIFIED`.
   - `pipeline.status`: `PIPELINE_VERIFIED` only with identity-level evidence for this environment, experiment, flag and metric event, newer than the fix (`window.since`); otherwise say delivery is not proven yet. On self-hosted with the Flagsmith database, offer `verify --event-store docker:<compose project> --identity <a real user id>` while that user goes through the flow.
   - `experiment.status`: `EXPERIMENT_HEALTHY`, `_PENDING` (waiting for data), `_REPAIR_REQUIRED` (next finding), `_UNVERIFIABLE`.
8. **Stop.** If a next finding remains, offer to repeat steps 3 to 7 for it. One finding at a time.

## Safety rules

- Read-only by default. `check` and `verify` change nothing in Flagsmith. `fix` and `canary` only after the human approves that exact action in this conversation.
- Flagsmith changes are fail-closed: allowed only for environments the human allowlisted with `--allow-env <key|name>` or `.experiment-doctor.json` `{"allowMutations": [...]}`. Never add an environment to the allowlist yourself unless the human names it for that purpose. `--yes` never bypasses the allowlist. Treat anything that looks like production as off-limits unless the human insists by name.
- Never print, log, commit or paste API keys: no `flagsmith auth token`, no `cat flagsmith.env`, no `echo $FLAGSMITH_API_KEY`. Commands use `<env-key>`; the CLI fills it in.
- Never start, pause or complete an experiment, change a rollout, weights or overrides, without approval. Do not edit the rollout of a running experiment.
- `canary` is an ingestion probe over HTTP for a `doctor-canary-*` identity. It does not test the app's SDK code, and without `--event-store` its best result is `ACCEPTED`, not proof of storage. Only on request, only in an allowlisted environment the human names.
- Do not use the Flagsmith MCP server to change experiments: it cannot start them, and its update is affected by issue #9136.

## When you need raw Flagsmith data

Use the official CLI with `--json --jq` so only the needed fields come back. Recipes: [references/flagsmith-cli.md](references/flagsmith-cli.md). One-screen state: `scripts/snapshot.sh <flag>`.

## References (load only when needed)

- [references/rules.md](references/rules.md): what each ED-xxx finding means and its usual fix.
- [references/json-output.md](references/json-output.md): the `check --json` and `verify --json` shapes.
- [references/known-bugs.md](references/known-bugs.md): Flagsmith issues the Doctor can point to, with states.
- [references/safety.md](references/safety.md): the allowlist, the canary and what each one proves.
